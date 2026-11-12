import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AUTOMATION_HUB_TABS, HubSubNav } from "@/components/hub-subnav";
import { actorQueryOptions } from "@/hooks/use-actor";
import { errorToAccessScreen } from "@/components/access-denied";
import {
  getAutomationOverview,
  triggerAutomation,
  updateAutomationSettings,
} from "@/lib/automation.functions";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/_authenticated/automation")({
  head: () => ({
    meta: [
      { title: "Automation | The AI School HRM" },
      {
        name: "description",
        content:
          "Scheduled attendance checks: missed check-outs, uncovered time, productivity flags and EOD locks across live data.",
      },
      { property: "og:title", content: "Automation | The AI School HRM" },
      {
        property: "og:description",
        content: "Configure and review the scheduled attendance automation rules.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: AutomationPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

const RULE_LABELS: Record<string, string> = {
  no_check_in: "No check-in",
  task_entry_reminder: "Task entry reminder",
  missed_check_out: "Missed check-out",
  uncovered_time: "Uncovered / missing entries",
  low_productivity: "Low productivity",
  high_rejection: "High rejection rate",
  eod_locked: "EOD locked",
};

const FIELDS: { key: string; label: string; hint: string; type: string }[] = [
  { key: "no_checkin_cutoff", label: "No check-in cut-off", hint: "Flag people with no check-in after this time (IST).", type: "time" },
  { key: "reminder_interval_minutes", label: "Reminder interval (minutes)", hint: "Nudge when no task entry has been logged for this long.", type: "number" },
  { key: "missed_checkout_grace_hours", label: "Missed check-out grace (hours)", hint: "How long an open day may stay open.", type: "number" },
  { key: "eod_lock_hours", label: "EOD lock window (hours)", hint: "After this, an unsubmitted day locks and needs a correction request.", type: "number" },
  { key: "low_productivity_pct", label: "Low productivity below (%)", hint: "Share of the real daily target.", type: "number" },
  { key: "high_rejection_pct", label: "High rejection above (%)", hint: "Rejected units as a share of reviewed units.", type: "number" },
  { key: "uncovered_ratio_pct", label: "Uncovered time above (%)", hint: "Worked minutes not covered by any entry.", type: "number" },
  { key: "lookback_days", label: "Look-back window (days)", hint: "How far back each run re-checks.", type: "number" },
];

function AutomationPage() {
  const queryClient = useQueryClient();
  const { data } = useSuspenseQuery({
    queryKey: ["automation-overview"],
    queryFn: () => getAutomationOverview(),
  });
  const [isRunning, setIsRunning] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [confirmRun, setConfirmRun] = useState(false);
  const [enabledFlag, setEnabledFlag] = useState<boolean>(
    () => (data.settings as { enabled?: boolean } | null)?.enabled !== false,
  );
  const [draft, setDraft] = useState<Record<string, string>>(() => {
    const s = (data.settings ?? {}) as Record<string, unknown>;
    return Object.fromEntries(FIELDS.map((f) => [f.key, String(s[f.key] ?? "")]));
  });

  const busy = isRunning || isSaving;

  async function runNow() {
    setIsRunning(true);
    try {
      const result = await triggerAutomation();
      toast.success(
        result.skipped
          ? result.reason ?? "Run skipped."
          : `Scanned ${result.daysScanned} live day(s): ${result.flagsCreated} new flag(s), ${result.notificationsSent} notification(s).`,
      );
      setConfirmRun(false);
      await queryClient.invalidateQueries({ queryKey: ["automation-overview"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The run failed.");
    } finally {
      setIsRunning(false);
    }
  }

  async function save() {
    setIsSaving(true);
    try {
      const payload: Record<string, number | string | boolean> = { enabled: enabledFlag };
      for (const field of FIELDS) {
        const value = draft[field.key] ?? "";
        payload[field.key] = field.type === "number" ? Number(value) : value;
      }
      await updateAutomationSettings({ data: payload });
      toast.success("Thresholds saved.");
      await queryClient.invalidateQueries({ queryKey: ["automation-overview"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save.");
    } finally {
      setIsSaving(false);
    }
  }

  const enabled = enabledFlag;

  return (
    <AppShell
      title="Automation"
      description="Scheduled checks run against live attendance only — imported history is never flagged, reminded about or locked."
      actions={
        <Button onClick={() => setConfirmRun(true)} disabled={busy}>
          {isRunning ? "Running…" : "Run now"}
        </Button>
      }
    >
      <HubSubNav tabs={AUTOMATION_HUB_TABS} />
      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-base">Thresholds</CardTitle>
              <Badge variant={enabled ? "success" : "neutral"}>
                {enabled ? "Active" : "Paused"}
              </Badge>
            </div>
            <CardDescription>
              {enabled ? "Automation is active." : "Automation is switched off."}
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <label
              htmlFor="automation-enabled"
              className="flex cursor-pointer items-center justify-between gap-3 rounded-md border p-3 text-sm"
            >
              <div>
                <p className="font-medium">Enable scheduled checks</p>
                <p className="text-xs text-muted-foreground">
                  When disabled, scheduled and manual ticks skip rule evaluation.
                </p>
              </div>
              <input
                id="automation-enabled"
                type="checkbox"
                className="size-4 shrink-0 accent-primary"
                checked={enabledFlag}
                onChange={(e) => setEnabledFlag(e.target.checked)}
              />
            </label>
            {FIELDS.map((field) => (
              <div key={field.key} className="space-y-1">
                <Label htmlFor={field.key}>{field.label}</Label>
                <Input
                  id={field.key}
                  type={field.type}
                  value={draft[field.key] ?? ""}
                  onChange={(e) => setDraft((d) => ({ ...d, [field.key]: e.target.value }))}
                />
                <p className="text-xs text-muted-foreground">{field.hint}</p>
              </div>
            ))}
            <Button onClick={() => void save()} disabled={busy} variant="secondary">
              {isSaving ? "Saving…" : "Save thresholds"}
            </Button>
          </CardContent>
        </Card>

        <div className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Recent runs</CardTitle>
              <CardDescription>Every tick is logged in IST, including skipped ones.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.runs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No runs recorded yet.</p>
              ) : (
                data.runs.map((run) => (
                  <div
                    key={run.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-sm"
                  >
                    <div>
                      <p className="flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          {new Date(run.started_at).toLocaleString("en-IN", {
                            timeZone: "Asia/Kolkata",
                            dateStyle: "medium",
                            timeStyle: "short",
                          })}{" "}
                          IST
                        </span>
                        <Badge variant={run.skipped ? "neutral" : "info"}>
                          {run.trigger_source}
                        </Badge>
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {run.skipped
                          ? run.reason ?? "Skipped"
                          : `${run.days_scanned} live day(s) scanned · ${run.flags_created} flag(s) · ${run.notifications_sent} notification(s)`}
                      </p>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Open flags</CardTitle>
              <CardDescription>One row per rule, per person, per day.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              {data.flags.length === 0 ? (
                <p className="text-sm text-muted-foreground">Nothing flagged.</p>
              ) : (
                data.flags.map((flag) => {
                  const isCritical = flag.severity === "critical";
                  return (
                    <div key={flag.id} className="rounded-md border p-3 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant={isCritical ? "destructive" : "warning"}>
                          {isCritical ? "Critical" : "Warning"} ·{" "}
                          {RULE_LABELS[flag.rule] ?? flag.rule}
                        </Badge>
                        <span className="font-medium">{flag.userName}</span>
                        <span className="text-xs tabular-nums text-muted-foreground">
                          {flag.work_date}
                        </span>
                      </div>
                      <p className="mt-1 text-muted-foreground">{flag.message}</p>
                    </div>
                  );
                })
              )}
            </CardContent>
          </Card>
        </div>
      </div>

      <AlertDialog open={confirmRun} onOpenChange={setConfirmRun}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Run attendance automation now?</AlertDialogTitle>
            <AlertDialogDescription>
              This immediately scans live attendance days across the configured look-back window (
              <span className="font-medium text-foreground">
                {draft["lookback_days"] || "default"} days
              </span>
              ), creates any new compliance flags, locks overdue EODs, and sends in-app
              notifications to affected employees.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isRunning}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={isRunning}
              onClick={(e) => {
                e.preventDefault();
                void runNow();
              }}
            >
              {isRunning ? "Running…" : "Run automation"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
