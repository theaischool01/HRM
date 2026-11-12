import { Badge } from "@/components/ui/badge";
import { ATTENDANCE_STATUS_LABELS } from "@/lib/daily.server";
import type { OversightRow } from "@/lib/oversight.server";

const PROBLEM = new Set([
  "review_required",
  "missed_check_out",
  "half_day",
  "present_hours_incomplete",
]);

function attendanceBadgeVariant(
  status: string,
): "success" | "info" | "warning" | "destructive" | "neutral" {
  if (status === "present_complete") return "success";
  if (status === "present_in_progress") return "info";
  if (status === "absent") return "destructive";
  if (PROBLEM.has(status)) return "warning";
  return "neutral";
}

export function OversightTable({
  rows,
  onSelect,
  selectedDayId,
}: {
  rows: OversightRow[];
  onSelect?: ((row: OversightRow) => void) | undefined;
  selectedDayId?: string | null | undefined;
}) {
  if (rows.length === 0) {
    return <p className="text-sm text-muted-foreground">No attendance days in this range.</p>;
  }
  return (
    <>
      <div className="space-y-2.5 sm:hidden">
        {rows.map((row) => {
          const isSelected = Boolean(selectedDayId && selectedDayId === row.dayId);
          return (
            <div
              key={row.dayId}
              role={onSelect ? "button" : undefined}
              tabIndex={onSelect ? 0 : undefined}
              aria-pressed={onSelect ? isSelected : undefined}
              onClick={onSelect ? () => onSelect(row) : undefined}
              onKeyDown={
                onSelect
                  ? (e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        onSelect(row);
                      }
                    }
                  : undefined
              }
              className={`space-y-2 rounded-lg border p-3 text-sm transition-colors ${
                onSelect
                  ? "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  : ""
              } ${isSelected ? "border-primary/50 bg-primary/5" : ""}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <p className="font-medium">{row.fullName}</p>
                  <p className="text-xs tabular-nums text-muted-foreground">{row.workDate}</p>
                </div>
                <Badge variant={attendanceBadgeVariant(row.status)}>
                  {ATTENDANCE_STATUS_LABELS[row.status] ?? row.status}
                </Badge>
              </div>
              <div className="grid grid-cols-3 gap-2 rounded-md bg-muted/40 p-2 text-xs">
                <div>
                  <span className="block text-muted-foreground">Worked</span>
                  <span className="font-medium tabular-nums">
                    {(row.metrics.workedMinutes / 60).toFixed(2)}h
                  </span>
                </div>
                <div>
                  <span className="block text-muted-foreground">Task / Uncov.</span>
                  <span className="font-medium tabular-nums">
                    {row.achievement.taskHours}h / {row.metrics.uncoveredMinutes}m
                  </span>
                </div>
                <div>
                  <span className="block text-muted-foreground">Units / Target</span>
                  <span className="font-medium tabular-nums">
                    {row.achievement.unitsCompleted} ·{" "}
                    {row.achievement.dailyAchievementPct != null
                      ? `${row.achievement.dailyAchievementPct}%`
                      : "—"}
                  </span>
                </div>
              </div>
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                <LocationCell row={row} />
                <span>EOD: {row.eodStatus ? row.eodStatus.replace(/_/g, " ") : "—"}</span>
              </div>
            </div>
          );
        })}
      </div>

      <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[880px] text-sm">
          <thead className="text-left text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              <th scope="col" className="py-2 pr-3">Person</th>
              <th scope="col" className="py-2 pr-3">Date</th>
              <th scope="col" className="py-2 pr-3">Status</th>
              <th scope="col" className="py-2 pr-3 text-right">Worked</th>
              <th scope="col" className="py-2 pr-3 text-right">Task hrs</th>
              <th scope="col" className="py-2 pr-3 text-right">Uncovered</th>
              <th scope="col" className="py-2 pr-3 text-right">Units</th>
              <th scope="col" className="py-2 pr-3 text-right">Target %</th>
              <th scope="col" className="py-2 pr-3">Location</th>
              <th scope="col" className="py-2 pr-3">EOD</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.map((row) => {
              const isSelected = Boolean(selectedDayId && selectedDayId === row.dayId);
              return (
                <tr
                  key={row.dayId}
                  role={onSelect ? "button" : undefined}
                  tabIndex={onSelect ? 0 : undefined}
                  aria-pressed={onSelect ? isSelected : undefined}
                  className={`${
                    onSelect
                      ? "cursor-pointer hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
                      : ""
                  } ${isSelected ? "bg-primary/5" : ""}`}
                  onClick={onSelect ? () => onSelect(row) : undefined}
                  onKeyDown={
                    onSelect
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            onSelect(row);
                          }
                        }
                      : undefined
                  }
                >
                  <td className="py-2 pr-3 font-medium">{row.fullName}</td>
                  <td className="py-2 pr-3 tabular-nums">{row.workDate}</td>
                  <td className="py-2 pr-3">
                    <Badge variant={attendanceBadgeVariant(row.status)}>
                      {ATTENDANCE_STATUS_LABELS[row.status] ?? row.status}
                    </Badge>
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {(row.metrics.workedMinutes / 60).toFixed(2)}h
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">{row.achievement.taskHours}h</td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.metrics.uncoveredMinutes}m
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.achievement.unitsCompleted}
                  </td>
                  <td className="py-2 pr-3 text-right tabular-nums">
                    {row.achievement.dailyAchievementPct != null
                      ? `${row.achievement.dailyAchievementPct}%`
                      : "—"}
                  </td>
                  <td className="py-2 pr-3">
                    <LocationCell row={row} />
                  </td>
                  <td className="py-2 pr-3 capitalize text-muted-foreground">
                    {row.eodStatus ? row.eodStatus.replace(/_/g, " ") : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </>
  );
}

const LOCATION_LABELS: Record<string, string> = {
  not_required: "Not required",
  verified: "Verified at office",
  failed: "Outside office",
  denied: "Permission denied",
  unavailable: "Unavailable",
};

function LocationCell({ row }: { row: OversightRow }) {
  if (row.locationStatus === "not_required") {
    return <span className="text-muted-foreground">—</span>;
  }
  const detail =
    row.locationDistanceM != null ? ` · ${Math.round(row.locationDistanceM)}m` : "";
  const variant =
    row.locationStatus === "verified"
      ? "success"
      : row.locationStatus === "failed" || row.locationStatus === "denied"
        ? "warning"
        : "neutral";
  return (
    <span className="whitespace-nowrap text-xs">
      <Badge variant={variant}>
        {LOCATION_LABELS[row.locationStatus] ?? row.locationStatus}
      </Badge>
      <span className="ml-1 text-muted-foreground">
        {row.officeName ?? ""}
        {detail}
      </span>
    </span>
  );
}

export const OVERSIGHT_CSV_COLUMNS = [
  { key: "person", header: "Person", value: (r: OversightRow) => r.fullName },
  { key: "date", header: "Work date", value: (r: OversightRow) => r.workDate },
  { key: "mode", header: "Work mode", value: (r: OversightRow) => r.workMode },
  { key: "in", header: "Check in", value: (r: OversightRow) => r.checkInAt ?? "" },
  { key: "out", header: "Check out", value: (r: OversightRow) => r.checkOutAt ?? "" },
  { key: "status", header: "Derived status", value: (r: OversightRow) => r.status },
  { key: "worked", header: "Worked minutes", value: (r: OversightRow) => r.metrics.workedMinutes },
  { key: "task", header: "Task minutes", value: (r: OversightRow) => r.metrics.taskMinutes },
  { key: "break", header: "Break minutes", value: (r: OversightRow) => r.metrics.breakMinutes },
  { key: "blocker", header: "Blocker minutes", value: (r: OversightRow) => r.metrics.blockerMinutes },
  {
    key: "uncovered",
    header: "Uncovered minutes",
    value: (r: OversightRow) => r.metrics.uncoveredMinutes,
  },
  { key: "units", header: "Units completed", value: (r: OversightRow) => r.achievement.unitsCompleted },
  { key: "project", header: "Project", value: (r: OversightRow) => r.projectCode ?? "" },
  { key: "dailyTarget", header: "Daily target", value: (r: OversightRow) => r.achievement.dailyTarget ?? "" },
  {
    key: "achievement",
    header: "Daily achievement %",
    value: (r: OversightRow) => r.achievement.dailyAchievementPct ?? "",
  },
  {
    key: "pace",
    header: "Pace achievement %",
    value: (r: OversightRow) => r.achievement.paceAchievementPct ?? "",
  },
  { key: "locStatus", header: "Location status", value: (r: OversightRow) => r.locationStatus },
  { key: "locOffice", header: "Office", value: (r: OversightRow) => r.officeName ?? "" },
  {
    key: "locDistance",
    header: "Distance from office (m)",
    value: (r: OversightRow) => (r.locationDistanceM == null ? "" : Math.round(r.locationDistanceM)),
  },
  { key: "eod", header: "EOD status", value: (r: OversightRow) => r.eodStatus ?? "" },
];
