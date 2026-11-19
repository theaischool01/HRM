import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { requirePermission } from "./actor.server";
import {
  APP_ROLES,
  canActorAssignRole,
  canModifyUserRoles,
  isReadOnlySafePermission,
  type AppRole,
} from "./permissions";

export const getPermissionMatrix = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    const [{ data: canManage }, { data: canAudit }] = await Promise.all([
      supabase.rpc("has_permission", { _user_id: userId, _permission: "rbac:manage:all" }),
      supabase.rpc("has_permission", { _user_id: userId, _permission: "audit:read:all" }),
    ]);
    if (canManage !== true && canAudit !== true) {
      await requirePermission(supabase, userId, "rbac:manage:all");
    }

    const [{ data: roles }, { data: permissions, error }, { data: rolePermissions }] =
      await Promise.all([
        supabase.from("roles").select("role, label, rank, description").order("rank"),
        supabase
          .from("permissions")
          .select("key, resource, action, scope, description")
          .order("resource")
          .order("action"),
        supabase.from("role_permissions").select("role, permission_key"),
      ]);
    if (error) throw error;
    return {
      roles: roles ?? [],
      permissions: permissions ?? [],
      rolePermissions: rolePermissions ?? [],
      canEdit: canManage === true,
    };
  });

export const setRolePermission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { role: string; permissionKey: string; enabled: boolean }) => {
    if (!input?.role || !input?.permissionKey) throw new Error("Role and permission are required.");
    if (input.role === "super_admin") {
      throw new Error("Super Admin permissions are fixed and cannot be edited.");
    }
    if (!APP_ROLES.includes(input.role as AppRole)) {
      throw new Error("Unknown role.");
    }
    if (input.role === "founder" && input.enabled && !isReadOnlySafePermission(input.permissionKey)) {
      throw new Error("Founder is a strictly read-only role and cannot be granted write or sensitive KYC permissions.");
    }
    return input;
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "rbac:manage:all");

    const { data: isSuper } = await supabase.rpc("has_role", {
      _user_id: userId,
      _role: "super_admin",
    });
    if (isSuper !== true) {
      throw new Error("Forbidden: Only Super Admin can modify root role permissions.");
    }

    if (data.enabled) {
      const { error } = await supabase
        .from("role_permissions")
        .upsert(
          { role: data.role as AppRole, permission_key: data.permissionKey },
          { onConflict: "role,permission_key" },
        );
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("role_permissions")
        .delete()
        .eq("role", data.role as AppRole)
        .eq("permission_key", data.permissionKey);
      if (error) throw error;
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: data.enabled ? "rbac.permission_granted" : "rbac.permission_revoked",
      entityType: "role",
      entityId: data.role,
      detail: { permission: data.permissionKey },
    });
    return { ok: true };
  });

export const setUserRoles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userId: string; roles: string[] }) => {
    if (!input?.userId) throw new Error("A person id is required.");
    if (!Array.isArray(input.roles) || input.roles.length === 0) {
      throw new Error("Every person needs at least one role.");
    }
    const invalid = input.roles.filter((r) => !APP_ROLES.includes(r as AppRole));
    if (invalid.length > 0) {
      throw new Error(`Invalid role(s): ${invalid.join(", ")}`);
    }
    return {
      userId: input.userId,
      roles: [...new Set(input.roles)] as AppRole[],
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, "rbac:assign:all");

    if (data.userId === userId) {
      throw new Error("You cannot change your own roles. Ask another authorized administrator.");
    }

    const [{ data: actorRoleRows }, { data: targetRoleRows }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", userId),
      supabase.from("user_roles").select("role").eq("user_id", data.userId),
    ]);

    const actorRoles = (actorRoleRows ?? []).map((r) => r.role as AppRole);
    const currentRoles = (targetRoleRows ?? []).map((r) => r.role as AppRole);

    if (data.roles.includes("super_admin") || currentRoles.includes("super_admin")) {
      throw new Error("Forbidden: The Super Admin role is protected and cannot be assigned or modified.");
    }

    if (!canModifyUserRoles(actorRoles, currentRoles)) {
      throw new Error(
        "Forbidden: You cannot modify roles for a user who holds higher or protected authority.",
      );
    }

    const addedRoles = data.roles.filter((r) => !currentRoles.includes(r));
    const removedRoles = currentRoles.filter((r) => !data.roles.includes(r));
    const changedRoles = [...addedRoles, ...removedRoles];

    for (const role of changedRoles) {
      if (!canActorAssignRole(userId, actorRoles, data.userId, currentRoles, role)) {
        if (role === "admin") {
          throw new Error("Forbidden: Only HR or Super Admin can assign or remove the Admin role.");
        }
        throw new Error(`Forbidden: Your role cannot grant or revoke the '${role}' role.`);
      }
    }

    if (removedRoles.length > 0) {
      const { error: deleteError } = await supabase
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .in("role", removedRoles);
      if (deleteError) throw deleteError;
    }

    if (addedRoles.length > 0) {
      const { error: insertError } = await supabase.from("user_roles").insert(
        addedRoles.map((role) => ({
          user_id: data.userId,
          role,
          granted_by: userId,
        })),
      );
      if (insertError) throw insertError;
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabase, {
      actorId: userId,
      action: "rbac.roles_assigned",
      entityType: "profile",
      entityId: data.userId,
      detail: {
        previous_roles: currentRoles,
        roles: data.roles,
        added: addedRoles,
        removed: removedRoles,
        actor_roles: actorRoles,
      },
    });

    if (addedRoles.includes("admin")) {
      await writeAudit(supabase, {
        actorId: userId,
        action: "rbac.admin_role_granted",
        entityType: "profile",
        entityId: data.userId,
        detail: { granted_by_roles: actorRoles },
      });
    }
    if (removedRoles.includes("admin")) {
      await writeAudit(supabase, {
        actorId: userId,
        action: "rbac.admin_role_revoked",
        entityType: "profile",
        entityId: data.userId,
        detail: { revoked_by_roles: actorRoles },
      });
    }

    return { ok: true, roles: data.roles };
  });

export const listAuditLogs = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await requirePermission(context.supabase, context.userId, "audit:read:all");
    const { data, error } = await context.supabase
      .from("audit_logs")
      .select("id, actor_id, actor_email, action, entity_type, entity_id, detail, created_at")
      .order("created_at", { ascending: false })
      .limit(300);
    if (error) throw error;
    return data ?? [];
  });
