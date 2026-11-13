import { BadgeCheck, Layers, ShieldAlert } from "lucide-react";
import { useState } from "react";
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
import { WORK_TYPE_LABELS, WORK_TYPES, workTypeLabel, type WorkType } from "@/lib/work-type";

const UNCLASSIFIED = "__unclassified__";

export type WorkTypeSectionData = {
  value: WorkType | null;
  assignedAt: string | null;
  assignedByName: string | null;
  schemaReady: boolean;
  canEdit: boolean;
};

export type AnnotationSectionData = {
  contributor: { eligible: boolean; reason: string };
  logging: { eligible: boolean; reason: string };
  allocations: {
    allocationId: string;
    projectCode: string | null;
    projectName: string | null;
    status: string | null | undefined;
    acknowledgedAt: string | null | undefined;
    hourlyTarget: number | null;
    dailyTarget: number | null;
    taskUnit: string | null;
  }[];
} | null;

/**
 * Work Type / Workstream — a single field, separate from Authorization Role,
 * Employment Category and Employment Status. Annotation details are shown only
 * when the person is classified as Annotation.
 */
export function WorkTypeSection({
  workType,
  annotation,
  reportingLeadName,
  busy,
  onSave,
}: {
  workType: WorkTypeSectionData;
  annotation: AnnotationSectionData;
  reportingLeadName: string | null;
  busy: boolean;
  onSave: (next: WorkType | null, reason: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState<string>(workType.value ?? UNCLASSIFIED);
  const [reason, setReason] = useState("");
  const dirty = draft !== (workType.value ?? UNCLASSIFIED);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 font-display text-base">
          <Layers className="size-4 text-primary" aria-hidden="true" /> Work Type
        </CardTitle>
        <CardDescription>
          The workstream this person is assigned to. It does not change their authorization role,
          employment category or employment status.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge
            variant={workType.value === "annotation" ? "default" : "outline"}
            className="text-xs"
          >
            {workTypeLabel(workType.value)}
          </Badge>
          {workType.assignedAt ? (
            <span className="text-xs text-muted-foreground">
              Assigned {new Date(workType.assignedAt).toLocaleDateString("en-IN")}
              {workType.assignedByName ? ` by ${workType.assignedByName}` : ""}
            </span>
          ) : (
            <span className="text-xs text-muted-foreground">Not yet classified by HR.</span>
          )}
        </div>

        {!workType.schemaReady ? (
          <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">
            Work Type becomes editable once database migration 20261113000000 is applied.
          </p>
        ) : workType.canEdit ? (
          <form
            className="grid gap-3 sm:grid-cols-[minmax(0,220px)_minmax(0,1fr)_auto] sm:items-end"
            onSubmit={async (e) => {
              e.preventDefault();
              await onSave(draft === UNCLASSIFIED ? null : (draft as WorkType), reason);
              setReason("");
            }}
          >
            <div className="space-y-1.5">
              <Label htmlFor="work-type-select">Work Type</Label>
              <Select value={draft} onValueChange={setDraft}>
                <SelectTrigger id="work-type-select">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={UNCLASSIFIED}>Unclassified</SelectItem>
                  {WORK_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>
                      {WORK_TYPE_LABELS[t]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="work-type-reason">Reason (audit trail)</Label>
              <Input
                id="work-type-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. Assigned to annotation production team"
              />
            </div>
            <Button type="submit" size="sm" disabled={busy || !dirty}>
              Save work type
            </Button>
          </form>
        ) : null}

        {workType.value === "annotation" && annotation ? (
          <AnnotationEligibilityPanel annotation={annotation} reportingLeadName={reportingLeadName} />
        ) : null}
      </CardContent>
    </Card>
  );
}

function AnnotationEligibilityPanel({
  annotation,
  reportingLeadName,
}: {
  annotation: NonNullable<AnnotationSectionData>;
  reportingLeadName: string | null;
}) {
  const active = annotation.allocations.find((a) => a.status === "active" && a.acknowledgedAt);
  const primary = active ?? annotation.allocations[0] ?? null;
  const ok = annotation.logging.eligible;

  return (
    <div className="space-y-3 rounded-lg border p-4">
      <div className="flex items-start gap-2">
        {ok ? (
          <BadgeCheck className="mt-0.5 size-4 text-emerald-600" aria-hidden="true" />
        ) : (
          <ShieldAlert className="mt-0.5 size-4 text-primary" aria-hidden="true" />
        )}
        <div>
          <p className="text-sm font-semibold">
            {ok ? "Eligible for hourly annotation logging" : "Hourly annotation logging unavailable"}
          </p>
          {!ok ? (
            <p className="text-xs text-muted-foreground">{annotation.logging.reason}</p>
          ) : null}
        </div>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
        <Row label="Assigned annotation project">
          {primary ? `${primary.projectCode ?? ""} ${primary.projectName ?? ""}`.trim() : "None"}
        </Row>
        <Row label="Active allocation">
          {active ? "Active & acknowledged" : primary ? humanStatus(primary) : "None"}
        </Row>
        <Row label="Reporting Lead">{reportingLeadName ?? "Not assigned"}</Row>
        <Row label="Hourly target">
          {primary?.hourlyTarget != null
            ? `${primary.hourlyTarget} ${primary.taskUnit ?? "units"}/hr`
            : "Not set"}
        </Row>
        <Row label="Daily target">
          {primary?.dailyTarget != null
            ? `${primary.dailyTarget} ${primary.taskUnit ?? "units"}/day`
            : "Not set"}
        </Row>
        <Row label="Logging availability">{ok ? "Open" : "Closed"}</Row>
      </dl>
    </div>
  );
}

function humanStatus(a: { status: string | null | undefined; acknowledgedAt: string | null | undefined }) {
  if (a.status === "pending_acknowledgment" || !a.acknowledgedAt) return "Awaiting acknowledgment";
  if (a.status === "paused") return "Paused";
  return a.status ?? "Unknown";
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="font-medium">{children}</dd>
    </div>
  );
}

