import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { Download, X } from "lucide-react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { HubSubNav, OVERSIGHT_HUB_TABS } from "@/components/hub-subnav";
import { errorToAccessScreen } from "@/components/access-denied";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { OVERSIGHT_CSV_COLUMNS, OversightTable } from "@/components/oversight-table";
import { getOversight, listReviewEvents, listTeamEods, reviewEodReport } from "@/lib/oversight.functions";
import { listTeamBlockers, resolveBlocker } from "@/lib/daily.functions";
import type { OversightRow } from "@/lib/oversight.server";
import { downloadCsv, toCsv } from "@/lib/csv";
import { REVIEW_ACTION_LABELS, optionsOf } from "@/lib/enums";
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const Route = createFileRoute("/_authenticated/team")({
  head: () => ({
    meta: [
      { title: "Team review | The AI School HRM" },
      {
        name: "description",
        content:
          "Lead view of team attendance, productivity against real project targets, and EOD review actions.",
      },
      { property: "og:title", content: "Team review | The AI School HRM" },
      {
        property: "og:description",
        content: "Review your team's day, approve EOD reports and export the same numbers.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: TeamPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

const ACTION_OPTIONS = optionsOf(REVIEW_ACTION_LABELS);
const HIGH_IMPACT_EOD_ACTIONS = new Set(["escalated", "performance_concern"]);

function eodBadgeVariant(
  status: string,
): "success" | "info" | "warning" | "destructive" | "neutral" {
  if (status === "reviewed" || status === "approved" || status === "approved_with_comment") {
    return "success";
  }
  if (status === "submitted") return "info";
  if (status === "revision_required" || status === "revision_requested") return "warning";
  if (status === "escalated" || status === "performance_concern") return "destructive";
  return "neutral";
}

function formatIstDateTime(iso: string): string {
  return `${new Date(iso).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    dateStyle: "medium",
    timeStyle: "short",
  })} IST`;
}

function TeamPage() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const canReviewEod = actor.can("eod:review:team");
  const canManageBlockers = actor.can("blockers:manage:team");

  const [range, setRange] = useState<{ from: string; to: string }>({ from: "", to: "" });
  const activeRange =
    range.from && range.to ? { from: range.from, to: range.to } : {};

  const { data } = useSuspenseQuery({
    queryKey: ["oversight", "team", range.from || "default", range.to || "default"],
    queryFn: () => getOversight({ data: activeRange }),
  });
  const { data: eods } = useSuspenseQuery({
    queryKey: ["team-eods", range.from || "default", range.to || "default"],
    queryFn: () => listTeamEods({ data: activeRange }),
  });
  const { data: teamBlockers = [] } = useQuery({
    queryKey: ["team-blockers"],
    queryFn: () => listTeamBlockers(),
    enabled: canManageBlockers,
  });
  const [selected, setSelected] = useState<OversightRow | null>(null);
  const [drafts, setDrafts] = useState<Record<string, { action: string; note: string }>>({});
  const [blockerNotes, setBlockerNotes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmEod, setConfirmEod] = useState<{
    id: string;
    personName: string;
    workDate: string;
    action: string;
    note: string;
  } | null>(null);

  const { data: events = [], isLoading: eventsLoading } = useQuery({
    queryKey: ["review-events", selected?.userId],
    queryFn: () => listReviewEvents({ data: { userId: selected!.userId } }),
    enabled: !!selected,
  });

  async function review(id: string) {
    const draft = drafts[id] ?? { action: "approved", note: "" };
    setBusy(id);
    try {
      await reviewEodReport({ data: { id, action: draft.action, note: draft.note || null } });
      toast.success(`Recorded: ${REVIEW_ACTION_LABELS[draft.action as never] ?? draft.action}.`);
      setConfirmEod(null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team-eods"] }),
        queryClient.invalidateQueries({ queryKey: ["oversight", "team"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not record the review.");
    } finally {
      setBusy(null);
    }
  }

  async function handleResolveBlocker(id: string) {
    setBusy(`blocker-${id}`);
    try {
      await resolveBlocker({
        data: { id, note: blockerNotes[id]?.trim() || null },
      });
      toast.success("Blocker resolved and employee notified.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["team-blockers"] }),
        queryClient.invalidateQueries({ queryKey: ["oversight", "team"] }),
      ]);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not resolve blocker.");
    } finally {
      setBusy(null);
    }
  }

  function exportCsv() {
    downloadCsv(
      `team-attendance-${data.filter.from}-to-${data.filter.to}.csv`,
      toCsv(data.rows, OVERSIGHT_CSV_COLUMNS),
    );
  }

  return (
    <AppShell
      title="Team review"
      description={`${data.filter.from} → ${data.filter.to} · ${data.summary.people} people · ${data.summary.days} days`}
      actions={
        <Button size="sm" variant="outline" onClick={exportCsv}>
          <Download className="mr-1.5 size-4" /> Export CSV
        </Button>
      }
    >
      <HubSubNav tabs={OVERSIGHT_HUB_TABS} />
      <div className="space-y-6">
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label htmlFor="team-from" className="text-xs text-muted-foreground">
              From date
            </Label>
            <Input
              id="team-from"
              type="date"
              className="h-9 w-40"
              value={range.from || data.filter.from}
              onChange={(e) =>
                setRange((r) => ({ from: e.target.value, to: r.to || data.filter.to }))
              }
            />
          </div>
          <div className="space-y-1">
            <Label htmlFor="team-to" className="text-xs text-muted-foreground">
              To date
            </Label>
            <Input
              id="team-to"
              type="date"
              className="h-9 w-40"
              value={range.to || data.filter.to}
              onChange={(e) =>
                setRange((r) => ({ from: r.from || data.filter.from, to: e.target.value }))
              }
            />
          </div>
          {(range.from || range.to) ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setRange({ from: "", to: "" })}
            >
              Reset range
            </Button>
          ) : null}
        </div>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Stat label="Worked hours" value={`${data.summary.workedHours}h`} />
          <Stat label="Units completed" value={data.summary.unitsCompleted} />
          <Stat
            label="Avg target achievement"
            value={
              data.summary.avgAchievementPct != null ? `${data.summary.avgAchievementPct}%` : "—"
            }
          />
          <Stat label="Days needing attention" value={data.summary.problemDays} />
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team days</CardTitle>
            <CardDescription>
              Select a row to drill into that person&apos;s review history. Every figure comes from
              the same derivation used by the export.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OversightTable
              rows={data.rows}
              onSelect={setSelected}
              selectedDayId={selected?.dayId}
            />
          </CardContent>
        </Card>

        {selected ? (
          <Card>
            <CardHeader className="flex flex-row flex-wrap items-start justify-between gap-2 space-y-0">
              <div className="space-y-1">
                <CardTitle className="text-base">{selected.fullName} — review history</CardTitle>
                <CardDescription>
                  {selected.workDate} · {selected.status.replace(/_/g, " ")} ·{" "}
                  {selected.achievement.unitsCompleted} units ·{" "}
                  {selected.achievement.dailyAchievementPct != null
                    ? `${selected.achievement.dailyAchievementPct}% of target`
                    : "no target set"}
                </CardDescription>
              </div>
              <Button
                size="sm"
                variant="ghost"
                aria-label="Close review history"
                onClick={() => setSelected(null)}
              >
                <X className="mr-1 size-4" /> Close
              </Button>
            </CardHeader>
            <CardContent className="space-y-2 text-sm">
              {eventsLoading ? (
                <p className="text-muted-foreground">Loading review history…</p>
              ) : events.length === 0 ? (
                <p className="text-muted-foreground">No review actions recorded yet.</p>
              ) : null}
              {events.map((event) => (
                <div key={event.id} className="rounded-md border p-2.5">
                  <p className="font-medium">
                    {REVIEW_ACTION_LABELS[event.action as never] ?? event.action} ·{" "}
                    <span className="capitalize">{event.entity_type.replace(/_/g, " ")}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {(event.profiles as { full_name?: string } | null)?.full_name ?? "Reviewer"} ·{" "}
                    {formatIstDateTime(event.created_at)}
                    {event.note ? ` · “${event.note}”` : ""}
                  </p>
                </div>
              ))}
            </CardContent>
          </Card>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">EOD reports</CardTitle>
            <CardDescription>
              Approve, approve with comment, request revision, escalate or flag a performance
              concern — each action records you and the time in IST.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {eods.reports.length === 0 ? (
              <p className="text-sm text-muted-foreground">No EOD reports in this range.</p>
            ) : null}
            {eods.reports.map((report) => {
              const draft = drafts[report.id] ?? { action: "approved", note: "" };
              const person = report.profiles as { full_name?: string } | null;
              return (
                <div key={report.id} className="space-y-2.5 rounded-md border p-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">
                      {person?.full_name ?? "Team member"} ·{" "}
                      <span className="tabular-nums">{report.work_date}</span>
                    </p>
                    <Badge variant={eodBadgeVariant(report.status)} className="capitalize">
                      {report.status.replace(/_/g, " ")}
                    </Badge>
                  </div>
                  <p className="text-muted-foreground">{report.highlights}</p>
                  {report.reviewed_at ? (
                    <p className="text-xs text-muted-foreground">
                      Last reviewed {formatIstDateTime(report.reviewed_at)}
                      {report.review_note ? ` · “${report.review_note}”` : ""}
                    </p>
                  ) : null}
                  {report.events.length > 0 ? (
                    <ul className="space-y-0.5 text-xs text-muted-foreground">
                      {report.events.map((event) => (
                        <li key={event.id}>
                          {REVIEW_ACTION_LABELS[event.action as never] ?? event.action} ·{" "}
                          {(event.profiles as { full_name?: string } | null)?.full_name ?? "—"} ·{" "}
                          {formatIstDateTime(event.created_at)}
                          {event.note ? ` · “${event.note}”` : ""}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {canReviewEod ? (
                    <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-end">
                      <div className="space-y-1 sm:w-52">
                        <Label
                          htmlFor={`eod-action-${report.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Decision
                        </Label>
                        <select
                          id={`eod-action-${report.id}`}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                          value={draft.action}
                          onChange={(e) =>
                            setDrafts({
                              ...drafts,
                              [report.id]: { ...draft, action: e.target.value },
                            })
                          }
                        >
                          {ACTION_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-1 sm:min-w-48 sm:flex-1">
                        <Label
                          htmlFor={`eod-note-${report.id}`}
                          className="text-xs text-muted-foreground"
                        >
                          Comment
                        </Label>
                        <Input
                          id={`eod-note-${report.id}`}
                          placeholder="Review note (recommended for revisions/escalations)"
                          value={draft.note}
                          onChange={(e) =>
                            setDrafts({
                              ...drafts,
                              [report.id]: { ...draft, note: e.target.value },
                            })
                          }
                        />
                      </div>
                      <Button
                        size="sm"
                        variant={HIGH_IMPACT_EOD_ACTIONS.has(draft.action) ? "destructive" : "default"}
                        disabled={busy === report.id}
                        onClick={() => {
                          if (HIGH_IMPACT_EOD_ACTIONS.has(draft.action)) {
                            setConfirmEod({
                              id: report.id,
                              personName: person?.full_name ?? "this employee",
                              workDate: report.work_date,
                              action: draft.action,
                              note: draft.note,
                            });
                          } else {
                            void review(report.id);
                          }
                        }}
                      >
                        {busy === report.id ? "Saving…" : "Record action"}
                      </Button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>

        {canManageBlockers ? (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Team blockers</CardTitle>
              <CardDescription>
                Open and recently resolved blockers raised by your direct reports or project team.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {teamBlockers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No blockers raised in this range.</p>
              ) : null}
              {teamBlockers.map((b) => {
                const workDate =
                  (b.attendance_days as { work_date?: string } | null)?.work_date ?? "—";
                return (
                  <div key={b.id} className="space-y-2.5 rounded-md border p-3 text-sm">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex flex-wrap items-center gap-2 font-medium">
                        <span>
                          {b.authorName} · <span className="tabular-nums">{workDate}</span> ·{" "}
                          <span className="capitalize">{b.category.replace(/_/g, " ")}</span>
                        </span>
                        <Badge
                          variant={
                            b.severity === "critical" || b.severity === "high"
                              ? "destructive"
                              : b.severity === "medium"
                                ? "warning"
                                : "neutral"
                          }
                          className="capitalize"
                        >
                          {b.severity}
                        </Badge>
                      </div>
                      <Badge
                        variant={b.status === "resolved" ? "success" : "warning"}
                        className="capitalize"
                      >
                        {b.status}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground">{b.description}</p>
                    {b.resolution_note ? (
                      <p className="text-xs text-muted-foreground">
                        Resolution note: “{b.resolution_note}”
                      </p>
                    ) : null}
                    {b.status !== "resolved" ? (
                      <div className="flex flex-col gap-2 pt-1 sm:flex-row sm:flex-wrap sm:items-end">
                        <div className="space-y-1 sm:min-w-48 sm:flex-1">
                          <Label
                            htmlFor={`blocker-note-${b.id}`}
                            className="text-xs text-muted-foreground"
                          >
                            Resolution note (optional)
                          </Label>
                          <Input
                            id={`blocker-note-${b.id}`}
                            placeholder="How was this unblocked?"
                            value={blockerNotes[b.id] ?? ""}
                            onChange={(e) =>
                              setBlockerNotes((prev) => ({ ...prev, [b.id]: e.target.value }))
                            }
                          />
                        </div>
                        <Button
                          size="sm"
                          disabled={busy === `blocker-${b.id}`}
                          onClick={() => handleResolveBlocker(b.id)}
                        >
                          {busy === `blocker-${b.id}` ? "Resolving…" : "Resolve blocker"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AlertDialog open={Boolean(confirmEod)} onOpenChange={(o) => !o && setConfirmEod(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Confirm {REVIEW_ACTION_LABELS[confirmEod?.action as never] ?? confirmEod?.action}?
            </AlertDialogTitle>
            <AlertDialogDescription>
              You are recording{" "}
              <span className="font-medium text-foreground">
                {REVIEW_ACTION_LABELS[confirmEod?.action as never] ?? confirmEod?.action}
              </span>{" "}
              on <span className="font-medium text-foreground">{confirmEod?.personName}</span>&apos;s
              EOD report for <span className="tabular-nums">{confirmEod?.workDate}</span>. This
              writes to the permanent review audit log and notifies operational leadership.
              {!confirmEod?.note.trim() ? (
                <span className="mt-2 block font-medium text-warning">
                  Note: You have not entered a comment explaining this escalation/flag.
                </span>
              ) : null}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={Boolean(busy)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={Boolean(busy)}
              onClick={(e) => {
                e.preventDefault();
                if (confirmEod) void review(confirmEod.id);
              }}
            >
              {busy ? "Recording…" : "Confirm & record"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className="text-2xl font-semibold tabular-nums">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}
