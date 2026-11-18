import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { toast } from "sonner";
import { Mail, RefreshCw } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  ONBOARDING_CATEGORY_LABELS,
  ONBOARDING_EMAIL_CHUNK,
  ONBOARDING_WORK_TYPE_LABELS,
  SETUP_EMAIL_STATUS_LABELS,
  type OnboardingCategory,
  type SetupEmailStatus,
} from "@/lib/onboarding/employee-onboarding";
import {
  listOnboardedEmployees,
  sendAccountSetupEmails,
  type OnboardedEmployeeRow,
} from "@/lib/onboarding.functions";
import { ROLE_LABELS, type AppRole } from "@/lib/permissions";
import type { WorkType } from "@/lib/work-type";

export const ONBOARDED_EMPLOYEES_QUERY_KEY = ["onboarding", "employees"] as const;

function statusVariant(status: SetupEmailStatus): "success" | "info" | "warning" | "destructive" | "neutral" {
  switch (status) {
    case "confirmed":
      return "success";
    case "smtp_accepted":
      return "info";
    case "queued":
      return "warning";
    case "failed":
      return "destructive";
    default:
      return "neutral";
  }
}

/** Accounts that may receive a (first or repeat) setup email. */
function isEmailEligible(row: OnboardedEmployeeRow): boolean {
  return row.setupEmailStatus !== "confirmed" && row.setupEmailStatus !== "queued";
}

type PendingSend = { ids: string[]; resend: boolean; label: string };

export function OnboardedEmployeesPanel(props: {
  /** Restrict the list to these accounts (e.g. rows created by the current bulk run). */
  onlyUserIds?: string[] | undefined;
  title?: string;
  description?: string;
}) {
  const queryClient = useQueryClient();
  const { data, isLoading, refetch, isFetching } = useQuery({
    queryKey: ONBOARDED_EMPLOYEES_QUERY_KEY,
    queryFn: () => listOnboardedEmployees(),
  });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, setPending] = useState<PendingSend | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);

  const rows = useMemo(() => {
    const all = data?.employees ?? [];
    if (!props.onlyUserIds) return all;
    const only = new Set(props.onlyUserIds);
    return all.filter((r) => only.has(r.userId));
  }, [data, props.onlyUserIds]);

  const eligibleSelected = rows.filter((r) => selected.has(r.userId) && isEmailEligible(r));
  const notSentEligible = rows.filter((r) => r.setupEmailStatus === "not_sent" || r.setupEmailStatus === "failed");

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function runSend(send: PendingSend) {
    setBusy(true);
    setPending(null);
    let accepted = 0;
    let failed = 0;
    let skipped = 0;
    try {
      for (let i = 0; i < send.ids.length; i += ONBOARDING_EMAIL_CHUNK) {
        const chunk = send.ids.slice(i, i + ONBOARDING_EMAIL_CHUNK);
        setProgress(`Sending ${Math.min(i + chunk.length, send.ids.length)} of ${send.ids.length}…`);
        const res = await sendAccountSetupEmails({
          data: { userIds: chunk, confirmed: true, resend: send.resend },
        });
        for (const r of res.results) {
          if (r.outcome === "smtp_accepted") accepted += 1;
          else if (r.outcome === "failed") failed += 1;
          else skipped += 1;
          if (r.outcome !== "smtp_accepted") {
            toast.message(`${r.email ?? "Employee"}: ${r.reason}`);
          }
        }
        await queryClient.invalidateQueries({ queryKey: ONBOARDED_EMPLOYEES_QUERY_KEY });
      }
      toast.success(
        `Setup emails: ${accepted} accepted by SMTP · ${failed} failed · ${skipped} skipped. SMTP acceptance is not proof of inbox delivery.`,
      );
      setSelected(new Set());
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send setup emails.");
    } finally {
      setBusy(false);
      setProgress(null);
      await queryClient.invalidateQueries({ queryKey: ONBOARDED_EMPLOYEES_QUERY_KEY });
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-3 space-y-0">
        <div>
          <CardTitle className="text-base">{props.title ?? "Created employees & setup emails"}</CardTitle>
          <CardDescription>
            {props.description ??
              "Accounts are created without email. Send the secure account setup email when you are ready. “Confirmed” appears only after the employee sets their own password."}
          </CardDescription>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" /> Refresh
          </Button>
          <Button
            type="button"
            size="sm"
            disabled={busy || eligibleSelected.length === 0}
            onClick={() =>
              setPending({
                ids: eligibleSelected.map((r) => r.userId),
                resend: eligibleSelected.some((r) => r.setupEmailStatus === "smtp_accepted"),
                label: `${eligibleSelected.length} selected employee${eligibleSelected.length === 1 ? "" : "s"}`,
              })
            }
          >
            <Mail className="mr-1.5 size-3.5" aria-hidden="true" />
            Send Setup Emails ({eligibleSelected.length})
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {progress ? (
          <p role="status" aria-live="polite" className="text-xs text-muted-foreground">
            {progress}
          </p>
        ) : null}
        {notSentEligible.length > 0 ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 px-3 py-2 text-xs">
            <span>
              <strong>{notSentEligible.length}</strong> account{notSentEligible.length === 1 ? "" : "s"} still need a
              setup email (not sent or failed).
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => setSelected(new Set(notSentEligible.map((r) => r.userId)))}
            >
              Select all pending
            </Button>
          </div>
        ) : null}

        {isLoading ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">No employees created through onboarding yet.</p>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <tr>
                  <th scope="col" className="w-10 px-3 py-2.5">
                    <span className="sr-only">Select</span>
                  </th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Employee</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Employee ID</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Role · Category · Work type</th>
                  <th scope="col" className="px-3 py-2.5 font-medium">Setup email</th>
                  <th scope="col" className="px-3 py-2.5 text-right font-medium">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => {
                  const eligible = isEmailEligible(r);
                  return (
                    <tr key={r.userId} className="hover:bg-muted/30">
                      <td className="px-3 py-2.5">
                        <Checkbox
                          aria-label={`Select ${r.fullName}`}
                          disabled={!eligible || busy}
                          checked={selected.has(r.userId)}
                          onCheckedChange={() => toggle(r.userId)}
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <p className="font-medium text-foreground">{r.fullName}</p>
                        <p className="text-xs text-muted-foreground">{r.workEmail}</p>
                      </td>
                      <td className="px-3 py-2.5 font-mono text-xs font-semibold">{r.employeeCode ?? "—"}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {r.roles.map((role) => ROLE_LABELS[role as AppRole] ?? role).join(", ")} ·{" "}
                        {ONBOARDING_CATEGORY_LABELS[r.category as OnboardingCategory] ?? r.category} ·{" "}
                        {r.workType ? (ONBOARDING_WORK_TYPE_LABELS[r.workType as WorkType] ?? r.workType) : "—"}
                      </td>
                      <td className="px-3 py-2.5">
                        <Badge variant={statusVariant(r.setupEmailStatus)}>
                          {SETUP_EMAIL_STATUS_LABELS[r.setupEmailStatus]}
                        </Badge>
                        {r.setupEmailError ? (
                          <p className="mt-1 max-w-xs break-words text-xs text-destructive">{r.setupEmailError}</p>
                        ) : null}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        {eligible ? (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={busy}
                            onClick={() =>
                              setPending({
                                ids: [r.userId],
                                resend: r.setupEmailStatus === "smtp_accepted",
                                label: r.fullName,
                              })
                            }
                          >
                            {r.setupEmailStatus === "not_sent" ? "Send account setup email" : "Resend setup email"}
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">—</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <AlertDialog open={pending !== null} onOpenChange={(open) => !open && setPending(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send account setup email{pending && pending.ids.length > 1 ? "s" : ""}?
            </AlertDialogTitle>
            <AlertDialogDescription className="break-words">
              This sends {pending?.ids.length ?? 0} secure, single-use setup email
              {pending && pending.ids.length === 1 ? "" : "s"} to <strong>{pending?.label}</strong> from{" "}
              <strong>hr@theaischool.co</strong> via Hostinger SMTP, paced to respect mailbox limits. No password is
              included. {pending?.resend ? "A previous setup email was already accepted; a new link will be issued." : ""}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              onClick={(e) => {
                e.preventDefault();
                if (pending) void runSend(pending);
              }}
            >
              Send {pending?.ids.length ?? 0} email{pending && pending.ids.length === 1 ? "" : "s"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
