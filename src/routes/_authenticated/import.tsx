import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { AppShell } from "@/components/app-shell";
import { AUTOMATION_HUB_TABS, HubSubNav } from "@/components/hub-subnav";
import { actorQueryOptions } from "@/hooks/use-actor";
import { errorToAccessScreen } from "@/components/access-denied";
import { supabase } from "@/integrations/supabase/client";
import {
  commitImport,
  getImportBatch,
  inviteImportedPeople,
  listImportBatches,
  resolveImportRow,
  stageImportBatch,
  type SheetPayload,
} from "@/lib/import.functions";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export const Route = createFileRoute("/_authenticated/import")({
  head: () => ({
    meta: [
      { title: "Legacy Import | The AI School HRM" },
      {
        name: "description",
        content:
          "Import historical attendance workbooks: preview every parsed cell, map unmatched people by hand, then commit.",
      },
      { property: "og:title", content: "Legacy Import | The AI School HRM" },
      {
        property: "og:description",
        content: "Staged, reviewable import of legacy attendance spreadsheets.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: ImportPage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

type SheetDraft = { name: string; grid: (string | number | null)[][]; projectId: string | null };

function ImportPage() {
  const queryClient = useQueryClient();
  const { data: batches } = useSuspenseQuery({
    queryKey: ["import-batches"],
    queryFn: () => listImportBatches(),
  });
  const [fileName, setFileName] = useState("");
  const [sheets, setSheets] = useState<SheetDraft[]>([]);
  const [activeBatch, setActiveBatch] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [committing, setCommitting] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"invite" | "commit" | null>(null);

  const { data: projects } = useQuery({
    queryKey: ["import-projects"],
    queryFn: async () => {
      const { data } = await supabase.from("projects").select("id, code, name").order("code");
      return data ?? [];
    },
  });
  const { data: people } = useQuery({
    queryKey: ["import-people"],
    queryFn: async () => {
      const { data } = await supabase
        .from("profiles")
        .select("id, full_name, work_email")
        .order("full_name");
      return data ?? [];
    },
  });
  const { data: batch } = useQuery({
    queryKey: ["import-batch", activeBatch],
    queryFn: () => getImportBatch({ data: { batchId: activeBatch! } }),
    enabled: Boolean(activeBatch),
  });

  async function onFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      const XLSX = await import("xlsx");
      const workbook = XLSX.read(await file.arrayBuffer(), { cellDates: false });
      const drafts: SheetDraft[] = workbook.SheetNames.map((name) => ({
        name,
        grid: XLSX.utils.sheet_to_json(workbook.Sheets[name]!, {
          header: 1,
          raw: false,
          defval: "",
        }) as (string | number | null)[][],
        projectId: null,
      }));
      setFileName(file.name);
      setSheets(drafts);
      toast.success(`Read ${drafts.length} sheet(s) from ${file.name}.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not read that workbook.");
    } finally {
      event.target.value = "";
      setBusy(false);
    }
  }

  async function stage() {
    setBusy(true);
    try {
      const payload: SheetPayload[] = sheets.map((s) => ({
        name: s.name,
        grid: s.grid,
        projectId: s.projectId,
      }));
      const result = await stageImportBatch({ data: { fileName, sheets: payload } });
      toast.success(
        `Staged ${result.people} people — ${result.matched} auto-matched, ${result.needsMapping} need manual mapping.`,
      );
      setActiveBatch(result.batchId);
      setSheets([]);
      await queryClient.invalidateQueries({ queryKey: ["import-batches"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Staging failed.");
    } finally {
      setBusy(false);
    }
  }

  async function resolve(rowId: string, resolution: "mapped" | "create_new" | "skipped", userId?: string) {
    try {
      await resolveImportRow({ data: { rowId, resolution, matchedUserId: userId ?? null } });
      await queryClient.invalidateQueries({ queryKey: ["import-batch", activeBatch] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not save that mapping.");
    }
  }

  async function invite() {
    setInviting(true);
    try {
      const result = await inviteImportedPeople({ data: { batchId: activeBatch! } });
      toast.success(`${result.queued} invitation(s) queued for throttled sending.`);
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: ["import-batch", activeBatch] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not queue invitations.");
    } finally {
      setInviting(false);
    }
  }

  async function commit() {
    setCommitting(true);
    try {
      const result = await commitImport({ data: { batchId: activeBatch! } });
      toast.success(
        `Committed ${result.attendanceRows} attendance row(s) and ${result.calendarRows} calendar entr(ies).`,
      );
      if (result.notes.length > 0) toast.message(result.notes.join(" "));
      setConfirmAction(null);
      await queryClient.invalidateQueries({ queryKey: ["import-batch", activeBatch] });
      await queryClient.invalidateQueries({ queryKey: ["import-batches"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Commit failed.");
    } finally {
      setCommitting(false);
    }
  }

  const rows = batch?.rows ?? [];
  const unmapped = rows.filter((r) => r.resolution === "pending");
  const createNewCount = rows.filter((r) => r.resolution === "create_new").length;
  const anyBusy = busy || inviting || committing;

  return (
    <AppShell
      title="Legacy import"
      description="Historical attendance lands with source = import: it is visible in history but never triggers a live automation rule."
    >
      <HubSubNav tabs={AUTOMATION_HUB_TABS} />
      <div className="space-y-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">1 · Upload a workbook</CardTitle>
            <CardDescription>
              One sheet per project, one row per person, one column per date.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="workbook">Excel or CSV file</Label>
              <Input
                id="workbook"
                type="file"
                accept=".xlsx,.xls,.csv"
                disabled={anyBusy}
                onChange={onFile}
              />
            </div>

            {sheets.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">2 · Map each sheet to a project</p>
                {sheets.map((sheet, index) => (
                  <div key={sheet.name} className="flex flex-wrap items-center gap-3">
                    <Label
                      htmlFor={`sheet-project-${index}`}
                      className="min-w-40 text-sm font-normal"
                    >
                      {sheet.name}
                    </Label>
                    <Select
                      value={sheet.projectId ?? "none"}
                      onValueChange={(value) =>
                        setSheets((current) =>
                          current.map((s, i) =>
                            i === index ? { ...s, projectId: value === "none" ? null : value } : s,
                          ),
                        )
                      }
                    >
                      <SelectTrigger id={`sheet-project-${index}`} className="w-full sm:w-72">
                        <SelectValue placeholder="Project" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="none">No project</SelectItem>
                        {(projects ?? []).map((p) => (
                          <SelectItem key={p.id} value={p.id}>
                            {p.code} — {p.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                ))}
                <Button onClick={() => void stage()} disabled={anyBusy}>
                  {busy ? "Parsing…" : "Parse and preview"}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Batches</CardTitle>
            <CardDescription>Select a batch to review or commit it.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {batches.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing imported yet.</p>
            ) : (
              batches.map((b) => (
                <button
                  key={b.id}
                  type="button"
                  aria-pressed={activeBatch === b.id}
                  onClick={() => setActiveBatch(b.id)}
                  className={`flex w-full flex-wrap items-center justify-between gap-2 rounded-md border p-3 text-left text-sm transition-colors hover:bg-muted/40 ${
                    activeBatch === b.id ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <span className="font-medium">{b.file_name}</span>
                  <span className="text-xs tabular-nums text-muted-foreground">
                    {b.date_from ?? "—"} → {b.date_to ?? "—"}
                  </span>
                  <Badge variant={b.status === "committed" ? "success" : "info"}>
                    {b.status}
                  </Badge>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {batch?.batch && (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">3 · Preview</CardTitle>
                <CardDescription>
                  {rows.length} people ·{" "}
                  {Object.entries(batch.cellCounts)
                    .map(([kind, count]) => `${count} ${kind}`)
                    .join(" · ")}
                  {rows.length > 100 ? " · showing first 100 rows" : ""}
                </CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                      <th scope="col" className="p-2">Person</th>
                      <th scope="col" className="p-2">Identifier</th>
                      <th scope="col" className="p-2">DOJ / LWD</th>
                      <th scope="col" className="p-2">Cells</th>
                      <th scope="col" className="p-2">Match</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.slice(0, 100).map((row) => {
                      const cells = batch.cells.filter((c) => c.row_id === row.id);
                      const invalid = cells.filter((c) => c.mapped_kind === "invalid").length;
                      const issues = row.date_issues as Record<string, string>;
                      const resVariant =
                        row.resolution === "pending"
                          ? "warning"
                          : row.resolution === "skipped"
                            ? "neutral"
                            : "success";
                      return (
                        <tr key={row.id} className="border-b align-top">
                          <td className="p-2 font-medium">{row.raw_name || "—"}</td>
                          <td className="p-2 text-muted-foreground">{row.raw_identifier || "—"}</td>
                          <td className="p-2 text-xs tabular-nums">
                            {row.parsed_doj ?? row.raw_doj ?? "—"} / {row.parsed_lwd ?? row.raw_lwd ?? "—"}
                            {Object.values(issues ?? {}).map((issue) => (
                              <p key={issue} className="text-destructive">
                                {issue}
                              </p>
                            ))}
                          </td>
                          <td className="p-2 text-xs tabular-nums">
                            {cells.length} parsed
                            {invalid > 0 && (
                              <span className="text-destructive"> · {invalid} unreadable</span>
                            )}
                          </td>
                          <td className="p-2">
                            <Badge variant={resVariant}>{row.resolution}</Badge>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">4 · Manual mapping queue</CardTitle>
                <CardDescription>
                  {unmapped.length} row(s) could not be matched automatically. Nothing commits for
                  them until you decide.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {unmapped.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Every row is resolved.</p>
                ) : (
                  unmapped.map((row) => (
                    <div key={row.id} className="flex flex-wrap items-center gap-3 rounded-md border p-3">
                      <div className="min-w-48">
                        <p className="text-sm font-medium">{row.raw_name || "Unnamed"}</p>
                        <p className="text-xs text-muted-foreground">
                          {row.raw_identifier || "no identifier"} — {row.match_reason}
                        </p>
                      </div>
                      <Label htmlFor={`map-row-${row.id}`} className="sr-only">
                        Map {row.raw_name || "row"} to an existing account
                      </Label>
                      <Select onValueChange={(value) => void resolve(row.id, "mapped", value)}>
                        <SelectTrigger id={`map-row-${row.id}`} className="w-full sm:w-72">
                          <SelectValue placeholder="Map to an existing account" />
                        </SelectTrigger>
                        <SelectContent>
                          {(people ?? []).map((p) => (
                            <SelectItem key={p.id} value={p.id}>
                              {p.full_name} — {p.work_email}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => void resolve(row.id, "create_new")}
                      >
                        Invite as new
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => void resolve(row.id, "skipped")}
                      >
                        Skip
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="text-base">5 · Invite and commit</CardTitle>
                <CardDescription>
                  New people go through the normal throttled invitation queue and appear in Workforce
                  with an unassigned reporting lead.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-wrap gap-3">
                <Button
                  variant="secondary"
                  onClick={() => setConfirmAction("invite")}
                  disabled={anyBusy || createNewCount === 0}
                >
                  {inviting ? "Queueing…" : `Queue invitations (${createNewCount})`}
                </Button>
                <Button
                  onClick={() => setConfirmAction("commit")}
                  disabled={anyBusy || batch.batch.status === "committed"}
                >
                  {committing
                    ? "Committing…"
                    : batch.batch.status === "committed"
                      ? "Batch committed"
                      : "Commit batch"}
                </Button>
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <AlertDialog
        open={confirmAction !== null}
        onOpenChange={(o) => !o && setConfirmAction(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {confirmAction === "invite"
                ? `Queue ${createNewCount} invitation(s)?`
                : `Commit import batch (${batch?.batch?.file_name ?? "workbook"})?`}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmAction === "invite" ? (
                <>
                  This will queue <span className="font-medium text-foreground">{createNewCount}</span>{" "}
                  onboarding invitation(s) for rows marked as{" "}
                  <span className="font-medium text-foreground">create_new</span> via the throttled
                  invitation dispatcher.
                </>
              ) : (
                <>
                  Historical attendance and calendar entries for all mapped rows in{" "}
                  <span className="font-medium text-foreground">{batch?.batch?.file_name}</span>{" "}
                  will be written with <code className="text-xs">source = import</code>.
                  {unmapped.length > 0 ? (
                    <span className="mt-2 block font-medium text-warning">
                      Warning: {unmapped.length} row(s) are still pending manual mapping and will not
                      be committed.
                    </span>
                  ) : null}
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={anyBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={anyBusy}
              onClick={(e) => {
                e.preventDefault();
                if (confirmAction === "invite") {
                  void invite();
                } else if (confirmAction === "commit") {
                  void commit();
                }
              }}
            >
              {inviting || committing
                ? "Processing…"
                : confirmAction === "invite"
                  ? "Queue invitations"
                  : "Commit batch"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
