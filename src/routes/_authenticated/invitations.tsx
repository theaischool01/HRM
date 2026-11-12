import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { errorToAccessScreen } from "@/components/access-denied";
import { HubSubNav, ONBOARDING_HUB_TABS } from "@/components/hub-subnav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import {
  enqueueInvitations,
  getNextEmployeeIdPreview,
  listInvitations,
  requeueInvitation,
  revokeInvitation,
  runInvitationDispatch,
} from "@/lib/invitations.functions";
import {
  APP_ROLES,
  assignableRolesFor,
  CATEGORY_LABELS,
  ROLE_LABELS,
  USER_CATEGORIES,
} from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/invitations")({
  head: () => ({
    meta: [
      { title: "Invitations | The AI School HRM" },
      {
        name: "description",
        content: "Queue, throttle and track staff invitations sent from The AI School HRM portal.",
      },
      { property: "og:title", content: "Invitations | The AI School HRM" },
      { property: "og:description", content: "Throttled invitation queue for staff onboarding." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: InvitationsPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

function inviteStatusBadgeVariant(
  status: string,
): "success" | "info" | "warning" | "destructive" | "neutral" {
  switch (status) {
    case "accepted":
      return "success";
    case "sent":
      return "info";
    case "queued":
    case "sending":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "neutral";
  }
}

function InvitationsPage() {
  const queryClient = useQueryClient();
  const actor = useActor();
  const canCreate = actor.can("invitations:create:all");
  const assignableRoles = assignableRolesFor(actor.roles);
  const roleOptions = assignableRoles.length > 0 ? assignableRoles : APP_ROLES;
  const { data: invitations } = useSuspenseQuery({
    queryKey: ["invitations"],
    queryFn: () => listInvitations(),
  });
  const { data: nextIdPreview } = useQuery({
    queryKey: ["next-employee-id-preview"],
    queryFn: () => getNextEmployeeIdPreview(),
    enabled: canCreate,
  });

  const [submittingInvite, setSubmittingInvite] = useState(false);
  const [dispatching, setDispatching] = useState(false);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{
    id: string;
    label: string;
  } | null>(null);

  const [form, setForm] = useState({
    email: "",
    fullName: "",
    role: "employee",
    category: "full_time",
    designation: "",
  });

  async function invite(event: React.FormEvent) {
    event.preventDefault();
    setSubmittingInvite(true);
    try {
      await enqueueInvitations({
        data: {
          invites: [
            {
              email: form.email.trim(),
              fullName: form.fullName.trim(),
              role: form.role,
              category: form.category,
              designation: form.designation || null,
            },
          ],
          source: "manual",
        },
      });
      toast.success("Invitation queued. The worker will send it shortly.");
      setForm({ ...form, email: "", fullName: "", designation: "" });
      await queryClient.invalidateQueries();
    } catch (error: unknown) {
      const errObj = error as { message?: string; error?: string } | null;
      const msg =
        errObj?.message ||
        errObj?.error ||
        (typeof error === "string" ? error : "Could not queue that invitation.");
      toast.error(msg);
    } finally {
      setSubmittingInvite(false);
    }
  }

  async function dispatchNow() {
    setDispatching(true);
    try {
      const result = await runInvitationDispatch();
      toast.success(
        result.skipped
          ? "Another dispatch run is already in progress."
          : `Sent ${result.sent}, requeued ${result.requeued}, failed ${result.failed}.`,
      );
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Dispatch failed.");
    } finally {
      setDispatching(false);
    }
  }

  async function handleRetry(id: string) {
    setRowBusyId(id);
    try {
      await requeueInvitation({ data: { id } });
      toast.success("Invitation requeued for delivery.");
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not retry invitation.");
    } finally {
      setRowBusyId(null);
    }
  }

  async function handleConfirmRevoke() {
    if (!revokeTarget) return;
    setRowBusyId(revokeTarget.id);
    try {
      await revokeInvitation({ data: { id: revokeTarget.id } });
      toast.success(`Invitation for ${revokeTarget.label} revoked.`);
      setRevokeTarget(null);
      await queryClient.invalidateQueries();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not revoke invitation.");
    } finally {
      setRowBusyId(null);
    }
  }

  const queuedCount = invitations.filter((r) => r.status === "queued").length;

  return (
    <AppShell
      title="Invitations"
      description="Every invite is queued and drained in throttled batches, so a 150-person import behaves like one invite."
      actions={
        canCreate ? (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={dispatching || submittingInvite}
            onClick={dispatchNow}
          >
            {dispatching
              ? "Dispatching…"
              : queuedCount > 0
                ? `Send queued now (${queuedCount})`
                : "Send queued now"}
          </Button>
        ) : null
      }
    >
      <HubSubNav tabs={ONBOARDING_HUB_TABS} />
      <div
        className={
          canCreate
            ? "grid gap-6 xl:grid-cols-[380px_minmax(0,1fr)]"
            : "grid gap-6"
        }
      >
        {canCreate ? (
          <Card className="h-fit">
            <CardHeader>
              <CardTitle className="text-base">Invite someone</CardTitle>
              <CardDescription>
                They receive a secure activation link to set their password.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={invite} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="invite-email" className="text-xs text-muted-foreground">
                    Work email <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="invite-email"
                    type="email"
                    required
                    disabled={submittingInvite}
                    placeholder="name@theaischool.in"
                    value={form.email}
                    onChange={(e) => setForm({ ...form, email: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-fullname" className="text-xs text-muted-foreground">
                    Full name <span className="text-primary">*</span>
                  </Label>
                  <Input
                    id="invite-fullname"
                    required
                    disabled={submittingInvite}
                    placeholder="Full legal name"
                    value={form.fullName}
                    onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-role" className="text-xs text-muted-foreground">
                    Role
                  </Label>
                  <Select
                    disabled={submittingInvite}
                    value={form.role}
                    onValueChange={(value) => setForm({ ...form, role: value })}
                  >
                    <SelectTrigger id="invite-role">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {roleOptions.map((role) => (
                        <SelectItem key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-category" className="text-xs text-muted-foreground">
                    Employment category
                  </Label>
                  <Select
                    disabled={submittingInvite}
                    value={form.category}
                    onValueChange={(value) => setForm({ ...form, category: value })}
                  >
                    <SelectTrigger id="invite-category">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {USER_CATEGORIES.map((category) => (
                        <SelectItem key={category} value={category}>
                          {CATEGORY_LABELS[category]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="invite-designation" className="text-xs text-muted-foreground">
                    Designation
                  </Label>
                  <Input
                    id="invite-designation"
                    disabled={submittingInvite}
                    placeholder="e.g. AI Data Associate"
                    value={form.designation}
                    onChange={(e) => setForm({ ...form, designation: e.target.value })}
                  />
                </div>
                <div className="rounded-md border border-border/80 bg-muted/40 p-2.5">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium text-muted-foreground">Employee ID</span>
                    <Badge variant="secondary" className="font-mono text-xs font-semibold">
                      {nextIdPreview ?? "TAS-001"}
                    </Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">
                    Preview only · Assigned automatically in sequence on account provisioning.
                  </p>
                </div>
                <Button type="submit" disabled={submittingInvite} className="w-full">
                  {submittingInvite ? "Queueing…" : "Add to queue"}
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : null}

        <div className="space-y-3">
          {/* Mobile invitation cards (<640px) */}
          <div className="space-y-2.5 sm:hidden">
            {invitations.length === 0 ? (
              <Card className="p-6 text-center text-sm text-muted-foreground">
                No invitations yet.
              </Card>
            ) : (
              invitations.map((row) => {
                const isRowBusy = rowBusyId === row.id;
                return (
                  <Card key={row.id} className="p-3.5">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-medium text-foreground">
                          {row.full_name ?? row.email}
                        </p>
                        <p className="truncate text-xs text-muted-foreground">{row.email}</p>
                      </div>
                      <Badge variant={inviteStatusBadgeVariant(row.status)}>{row.status}</Badge>
                    </div>
                    {row.last_error && (
                      <p className="mt-1.5 break-words text-xs text-destructive">
                        {row.last_error}
                      </p>
                    )}
                    <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span className="font-mono">Attempts: {row.attempts ?? 0}</span>
                      {canCreate && (
                        <div className="flex items-center gap-1.5">
                          {row.status === "failed" && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={isRowBusy}
                              onClick={() => void handleRetry(row.id)}
                            >
                              {isRowBusy ? "Retrying…" : "Retry"}
                            </Button>
                          )}
                          {(row.status === "queued" || row.status === "sent") && (
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              disabled={isRowBusy}
                              onClick={() =>
                                setRevokeTarget({
                                  id: row.id,
                                  label: row.full_name ?? row.email,
                                })
                              }
                            >
                              Revoke
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                  </Card>
                );
              })
            )}
          </div>

          {/* Tablet & Desktop invitation table (>=640px) */}
          <Card className="hidden overflow-hidden p-0 sm:block">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[520px] text-sm">
                <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Invitee
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Status
                    </th>
                    <th scope="col" className="px-4 py-3 font-medium">
                      Attempts
                    </th>
                    {canCreate && (
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {invitations.map((row) => {
                    const isRowBusy = rowBusyId === row.id;
                    return (
                      <tr key={row.id} className="hover:bg-muted/30">
                        <td className="px-4 py-3">
                          <p className="font-medium text-foreground">
                            {row.full_name ?? row.email}
                          </p>
                          <p className="text-xs text-muted-foreground">{row.email}</p>
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={inviteStatusBadgeVariant(row.status)}>{row.status}</Badge>
                          {row.last_error ? (
                            <p className="mt-1 max-w-xs break-words text-xs text-destructive">
                              {row.last_error}
                            </p>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground tabular-nums">
                          {row.attempts ?? 0}
                        </td>
                        {canCreate && (
                          <td className="px-4 py-3 text-right">
                            {row.status === "failed" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isRowBusy}
                                onClick={() => void handleRetry(row.id)}
                              >
                                {isRowBusy ? "Retrying…" : "Retry"}
                              </Button>
                            ) : null}
                            {row.status === "queued" || row.status === "sent" ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                disabled={isRowBusy}
                                onClick={() =>
                                  setRevokeTarget({
                                    id: row.id,
                                    label: row.full_name ?? row.email,
                                  })
                                }
                              >
                                Revoke
                              </Button>
                            ) : null}
                          </td>
                        )}
                      </tr>
                    );
                  })}
                  {invitations.length === 0 ? (
                    <tr>
                      <td
                        colSpan={canCreate ? 4 : 3}
                        className="px-4 py-10 text-center text-muted-foreground"
                      >
                        No invitations yet.
                      </td>
                    </tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </Card>
        </div>
      </div>

      <AlertDialog
        open={revokeTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRevokeTarget(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke invitation?</AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              This cancels the pending onboarding invitation for{" "}
              <strong>{revokeTarget?.label}</strong> so the activation link can no longer be used.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={rowBusyId !== null}>Keep invitation</AlertDialogCancel>
            <AlertDialogAction
              disabled={rowBusyId !== null}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                void handleConfirmRevoke();
              }}
            >
              {rowBusyId !== null ? "Revoking…" : "Revoke invitation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
