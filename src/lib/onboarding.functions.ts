import { createServerFn } from "@tanstack/react-start";
import type { SupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { loadActor, requirePermission } from "./actor.server";
import {
  ACCOUNT_SETUP_TEMPLATE_SLUG,
  deriveSetupEmailStatus,
  isCreatableRow,
  ONBOARDING_CREATE_CHUNK,
  ONBOARDING_EMAIL_CHUNK,
  ONBOARDING_EMAIL_PACING_MS,
  ONBOARDING_MAX_ROWS,
  onboardingRolesFor,
  summariseOnboardingRows,
  toPreviewRow,
  validateOnboardingRows,
  type OnboardingRawRow,
  type SetupEmailStatus,
} from "./onboarding/employee-onboarding";

const ONBOARDING_PERMISSION = "workforce:create:all" as const;

function sanitizeRawRows(rows: unknown, max: number): OnboardingRawRow[] {
  if (!Array.isArray(rows) || rows.length === 0) throw new Error("No employee rows were provided.");
  if (rows.length > max) throw new Error(`At most ${max} rows can be processed per request.`);
  return rows.map((r, i) => {
    const src = (r ?? {}) as Record<string, unknown>;
    const out: OnboardingRawRow = {
      rowNumber: Number.isInteger(src["rowNumber"]) ? Number(src["rowNumber"]) : i + 2,
    };
    for (const key of [
      "first_name",
      "last_name",
      "work_email",
      "date_of_birth",
      "work_type",
      "role",
      "employment_category",
      "designation",
      "department",
      "joining_date",
      "reporting_lead_email",
      "internship_start",
      "internship_end",
    ] as const) {
      const v = src[key];
      if (v !== undefined && v !== null) out[key] = String(v).slice(0, 300);
    }
    return out;
  });
}

/** Reference data for the onboarding UI. Writes nothing. */
export const getOnboardingContext = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, ONBOARDING_PERMISSION);
    const actor = await loadActor(supabase, userId);
    const { buildOnboardingLookups, onboardingAssignableRoles } = await import(
      "./onboarding/provision.server"
    );
    const [lookups, { data: departments }, { data: nextId }] = await Promise.all([
      buildOnboardingLookups(actor.roles),
      supabase.from("departments").select("id, name, code").order("name"),
      supabase.rpc("peek_next_employee_id"),
    ]);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const leadIds = [...lookups.leadsByEmail.values()];
    const { data: leadProfiles } = leadIds.length
      ? await supabaseAdmin.from("profiles").select("id, full_name, work_email").in("id", leadIds)
      : { data: [] as { id: string; full_name: string | null; work_email: string | null }[] };

    return {
      assignableRoles: onboardingRolesFor(onboardingAssignableRoles(actor.roles)),
      departments: departments ?? [],
      leads: (leadProfiles ?? [])
        .map((l) => ({ id: l.id, fullName: l.full_name ?? "", workEmail: l.work_email ?? "" }))
        .sort((a, b) => a.fullName.localeCompare(b.fullName)),
      nextEmployeeIdPreview: typeof nextId === "string" ? nextId : null,
      todayIso: lookups.todayIso,
    };
  });

/** Validates rows against live data and returns a preview. NEVER creates anything. */
export const validateOnboardingBatch = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { rows: OnboardingRawRow[] }) => ({
    rows: sanitizeRawRows(input?.rows, ONBOARDING_MAX_ROWS),
  }))
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, ONBOARDING_PERMISSION);
    const actor = await loadActor(supabase, userId);
    const { buildOnboardingLookups } = await import("./onboarding/provision.server");
    const validated = validateOnboardingRows(data.rows, await buildOnboardingLookups(actor.roles));
    return {
      rows: validated.map(toPreviewRow),
      summary: summariseOnboardingRows(validated),
    };
  });

export type CreateEmployeeResult = {
  rowNumber: number;
  fullName: string;
  workEmail: string;
  outcome: "created" | "skipped" | "duplicate" | "failed";
  employeeCode: string | null;
  userId: string | null;
  reason: string;
};

/**
 * Creates accounts for validated, authorised rows only. Bounded per call,
 * idempotent per (batchKey, email), never sends email.
 */
export const createOnboardedEmployees = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { batchKey: string; source: "single" | "bulk"; rows: OnboardingRawRow[] }) => {
    if (input?.source !== "single" && input?.source !== "bulk") throw new Error("Unknown source.");
    return {
      batchKey: String(input.batchKey ?? ""),
      source: input.source,
      rows: sanitizeRawRows(input?.rows, ONBOARDING_CREATE_CHUNK),
    };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, ONBOARDING_PERMISSION);
    const actor = await loadActor(supabase, userId);
    const { assertBatchKey, buildOnboardingLookups, findPreviousProvision, idempotencyKeyFor, provisionEmployee } =
      await import("./onboarding/provision.server");
    const batchKey = assertBatchKey(data.batchKey);

    const lookups = await buildOnboardingLookups(actor.roles);
    const results: CreateEmployeeResult[] = [];

    for (const raw of data.rows) {
      const email = String(raw.work_email ?? "").trim().toLowerCase();
      const key = idempotencyKeyFor(batchKey, email);

      // Safe retry: a row already created by this batch reports its original result.
      const previous = email ? await findPreviousProvision(key) : null;
      if (previous) {
        results.push({
          rowNumber: raw.rowNumber,
          fullName: `${raw.first_name ?? ""} ${raw.last_name ?? ""}`.trim(),
          workEmail: email,
          outcome: "created",
          employeeCode: previous.employeeCode,
          userId: previous.userId,
          reason: "Already created in an earlier attempt (not duplicated).",
        });
        continue;
      }

      const [row] = validateOnboardingRows([raw], lookups);
      if (!row || !isCreatableRow(row)) {
        results.push({
          rowNumber: raw.rowNumber,
          fullName: row?.fullName ?? "",
          workEmail: email,
          outcome: row?.status === "duplicate" ? "duplicate" : "skipped",
          employeeCode: null,
          userId: null,
          reason: row?.errors.join(" ") || "Row failed validation.",
        });
        continue;
      }

      const outcome = await provisionEmployee({ row, actorId: userId, idempotencyKey: key, source: data.source });
      if (outcome.outcome === "created") {
        lookups.existingEmails.set(row.workEmail, "profile");
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          workEmail: row.workEmail,
          outcome: "created",
          employeeCode: outcome.employeeCode,
          userId: outcome.userId,
          reason: outcome.replayed ? "Already created in an earlier attempt." : "Account created. No email sent.",
        });
      } else {
        results.push({
          rowNumber: row.rowNumber,
          fullName: row.fullName,
          workEmail: row.workEmail,
          outcome: outcome.outcome,
          employeeCode: null,
          userId: null,
          reason: outcome.reason,
        });
      }
    }

    return { results };
  });

export type OnboardedEmployeeRow = {
  userId: string;
  fullName: string;
  workEmail: string;
  employeeCode: string | null;
  designation: string | null;
  category: string;
  workType: string | null;
  roles: string[];
  accountStatus: string;
  createdAt: string;
  setupEmailStatus: SetupEmailStatus;
  setupEmailUpdatedAt: string | null;
  setupEmailError: string | null;
};

/** Recently provisioned accounts with their setup-email status (no DOB). */
export const listOnboardedEmployees = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, ONBOARDING_PERMISSION);
    const actor = await loadActor(supabase, userId);
    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { canModifyUserRoles } = await import("./permissions");

    const { data: audits } = await supabaseAdmin
      .from("audit_logs")
      .select("entity_id, created_at")
      .eq("action", "employee.provisioned")
      .order("created_at", { ascending: false })
      .limit(200);
    const ids = [...new Set((audits ?? []).map((a) => a.entity_id).filter(Boolean) as string[])];
    if (ids.length === 0) return { employees: [] as OnboardedEmployeeRow[] };

    const [{ data: rawProfiles }, { data: roles }] = await Promise.all([
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabaseAdmin as unknown as SupabaseClient<any>)
        .from("profiles")
        .select(
          "id, full_name, work_email, employee_code, designation, category, work_type, account_status, must_change_password, created_at",
        )
        .in("id", ids),
      supabaseAdmin.from("user_roles").select("user_id, role").in("user_id", ids),
    ]);
    const profiles = (rawProfiles ?? []) as {
      id: string;
      full_name: string | null;
      work_email: string | null;
      employee_code: string | null;
      designation: string | null;
      category: string;
      work_type: string | null;
      account_status: string;
      must_change_password: boolean | null;
      created_at: string;
    }[];
    const rolesByUser = new Map<string, string[]>();
    for (const r of roles ?? []) rolesByUser.set(r.user_id, [...(rolesByUser.get(r.user_id) ?? []), r.role]);

    const emails = profiles.map((p) => p.work_email).filter(Boolean) as string[];
    const { data: messages } = emails.length
      ? await supabaseAdmin
          .from("email_messages")
          .select("recipient_email, status, error_message, created_at, updated_at")
          .eq("template_slug", ACCOUNT_SETUP_TEMPLATE_SLUG)
          .in("recipient_email", emails)
          .order("created_at", { ascending: false })
      : { data: [] as { recipient_email: string; status: string; error_message: string | null; created_at: string; updated_at: string }[] };
    const latest = new Map<string, { status: string; error_message: string | null; updated_at: string }>();
    for (const m of messages ?? []) if (!latest.has(m.recipient_email)) latest.set(m.recipient_email, m);

    const employees: OnboardedEmployeeRow[] = profiles
      .filter((p) => {
        const r = rolesByUser.get(p.id) ?? [];
        return !r.includes("super_admin") && canModifyUserRoles(actor.roles, r);
      })
      .map((p) => {
        const msg = p.work_email ? latest.get(p.work_email) : undefined;
        return {
          userId: p.id,
          fullName: p.full_name ?? "",
          workEmail: p.work_email ?? "",
          employeeCode: p.employee_code,
          designation: p.designation,
          category: p.category,
          workType: (p as { work_type?: string | null }).work_type ?? null,
          roles: rolesByUser.get(p.id) ?? [],
          accountStatus: p.account_status,
          createdAt: p.created_at,
          setupEmailStatus: deriveSetupEmailStatus({
            passwordSetupComplete: (p as { must_change_password?: boolean }).must_change_password === false,
            latestMessageStatus: msg?.status ?? null,
          }),
          setupEmailUpdatedAt: msg?.updated_at ?? null,
          setupEmailError: msg?.status === "failed" ? (msg.error_message ?? "Send failed.") : null,
        };
      })
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));

    return { employees };
  });

/** Explicit, confirmed HR action: sends secure setup emails via Hostinger SMTP. */
export const sendAccountSetupEmails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { userIds: string[]; confirmed: boolean; resend?: boolean }) => {
    if (input?.confirmed !== true) throw new Error("Confirm before sending setup emails.");
    const ids = Array.isArray(input.userIds) ? [...new Set(input.userIds.map(String))] : [];
    if (ids.length === 0) throw new Error("Select at least one employee.");
    if (ids.length > ONBOARDING_EMAIL_CHUNK) {
      throw new Error(`At most ${ONBOARDING_EMAIL_CHUNK} setup emails can be sent per request.`);
    }
    if (ids.some((id) => !/^[0-9a-f-]{36}$/i.test(id))) throw new Error("Invalid employee id.");
    return { userIds: ids, resend: input.resend === true };
  })
  .handler(async ({ data, context }) => {
    const { supabase, userId } = context;
    await requirePermission(supabase, userId, ONBOARDING_PERMISSION);
    const actor = await loadActor(supabase, userId);
    const { assertSmtpReady, sendAccountSetupEmail } = await import("./onboarding/setup-email.server");
    assertSmtpReady();

    const results = [];
    for (let i = 0; i < data.userIds.length; i += 1) {
      const result = await sendAccountSetupEmail({
        targetUserId: data.userIds[i]!,
        actorId: userId,
        actorRoles: actor.roles,
        allowResend: data.resend,
      });
      results.push(result);
      if (result.outcome !== "skipped" && i < data.userIds.length - 1) {
        await new Promise((resolve) => setTimeout(resolve, ONBOARDING_EMAIL_PACING_MS));
      }
    }
    return { results };
  });

/**
 * Called by the employee from the secure setup / recovery page. Sets the
 * password the employee chose (server-side policy enforced) and, in the same
 * step, records account setup as "Confirmed". The flag can never be cleared
 * without an actual password change. The password is never logged.
 */
export const completeAccountSetup = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .validator((input: { newPassword: string }) => {
    const pwd = String(input?.newPassword ?? "");
    if (pwd.length > 128) throw new Error("Password is too long.");
    return { newPassword: pwd };
  })
  .handler(async ({ data, context }) => {
    const { userId } = context;
    const { evaluatePasswordPolicy } = await import("./password-policy");
    const policy = evaluatePasswordPolicy(data.newPassword);
    if (!policy.isValid) throw new Error(policy.errorMessage ?? "Password does not meet the policy.");

    const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
    const { error: pwError } = await supabaseAdmin.auth.admin.updateUserById(userId, {
      password: data.newPassword,
    });
    if (pwError) throw new Error("Could not update your password. Request a new setup link.");

    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("id, must_change_password, employee_code")
      .eq("id", userId)
      .maybeSingle();
    const wasPending = profile?.must_change_password === true;
    if (wasPending) {
      await supabaseAdmin
        .from("profiles")
        .update({ must_change_password: false } as never)
        .eq("id", userId)
        .eq("must_change_password", true);
    }

    const { writeAudit } = await import("./audit.server");
    await writeAudit(supabaseAdmin, {
      actorId: userId,
      action: wasPending ? "account.setup_completed" : "password.reset_completed",
      entityType: "profile",
      entityId: userId,
      detail: { employee_code: profile?.employee_code ?? null, method: "secure_link_password_set" },
    });
    return { ok: true, setupCompleted: wasPending };
  });
