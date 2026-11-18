import * as XLSX from "xlsx";
import type { OversightRow } from "@/lib/oversight.server";
import { downloadCsv, toCsv, type CsvColumn, neutralizeFormula } from "@/lib/csv";
import { formatMinutesHuman } from "./attendance-monitoring";

function formatIstTime(iso: string | null): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleTimeString("en-IN", {
      timeZone: "Asia/Kolkata",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  } catch {
    return "—";
  }
}

export const ATTENDANCE_MONITORING_COLUMNS: CsvColumn<OversightRow>[] = [
  { key: "workDate", header: "Work Date", value: (r) => r.workDate },
  { key: "employeeCode", header: "Employee ID", value: (r) => r.employeeCode || "—" },
  { key: "fullName", header: "Full Name", value: (r) => r.fullName },
  { key: "workEmail", header: "Work Email", value: (r) => r.workEmail || "—" },
  { key: "department", header: "Department", value: (r) => r.departmentName || "Operations" },
  { key: "role", header: "Role", value: (r) => r.role },
  { key: "workType", header: "Work Type", value: (r) => r.workType },
  { key: "scheduledCheckIn", header: "Scheduled Check-In (IST)", value: () => "10:00 AM IST" },
  { key: "actualCheckIn", header: "Actual Check-In (IST)", value: (r) => formatIstTime(r.checkInAt) },
  { key: "arrivalStatus", header: "Morning Arrival Status", value: (r) => r.displayArrivalStatus },
  { key: "minutesLate", header: "Minutes Late", value: (r) => r.minutesLate },
  { key: "actualCheckOut", header: "Actual Check-Out (IST)", value: (r) => formatIstTime(r.checkOutAt) },
  {
    key: "attendedHours",
    header: "Total Attended Duration",
    value: (r) => formatMinutesHuman(r.metrics.workedMinutes),
  },
  {
    key: "requiredHours",
    header: "Required Hours",
    value: (r) => `${(r.requiredMinutes / 60).toFixed(1)}h`,
  },
  { key: "status", header: "Attendance Classification", value: (r) => r.status.replace(/_/g, " ") },
  {
    key: "lunchStart",
    header: "Lunch Break Start (IST)",
    value: (r) => formatIstTime(r.lunchBreak?.startedAt ?? null),
  },
  {
    key: "lunchEnd",
    header: "Lunch Break End (IST)",
    value: (r) => formatIstTime(r.lunchBreak?.endedAt ?? null),
  },
  {
    key: "lunchDuration",
    header: "Lunch Duration (Mins)",
    value: (r) => r.lunchBreak?.durationMinutes ?? 0,
  },
  {
    key: "lunchReturnStatus",
    header: "Lunch Return Status",
    value: (r) => r.lunchBreak?.returnStatus ?? "not_taken",
  },
  {
    key: "shortBreakStart",
    header: "Short Break Start (IST)",
    value: (r) => formatIstTime(r.shortBreak?.startedAt ?? null),
  },
  {
    key: "shortBreakEnd",
    header: "Short Break End (IST)",
    value: (r) => formatIstTime(r.shortBreak?.endedAt ?? null),
  },
  {
    key: "shortBreakDuration",
    header: "Short Break Duration (Mins)",
    value: (r) => r.shortBreak?.durationMinutes ?? 0,
  },
  {
    key: "shortBreakReturnStatus",
    header: "Short Break Return Status",
    value: (r) => r.shortBreak?.returnStatus ?? "not_taken",
  },
  {
    key: "personalizedBreaksCount",
    header: "Personalized Breaks Count",
    value: (r) => r.personalizedBreaks.length,
  },
  {
    key: "totalBreakMinutes",
    header: "Total Break Minutes",
    value: (r) => r.totalBreakMinutes,
  },
  {
    key: "totalBreakOvertime",
    header: "Total Break Overtime (Mins)",
    value: (r) => r.breakOvertimeMinutes,
  },
  {
    key: "eodStatus",
    header: "EOD Status",
    value: (r) => (r.eodStatus ? r.eodStatus.replace(/_/g, " ") : "Pending"),
  },
];

export function exportAttendanceCsv(rows: OversightRow[], from: string, to: string) {
  const filename = `attendance-breaks-report-${from}-to-${to}.csv`;
  const csvData = toCsv(rows, ATTENDANCE_MONITORING_COLUMNS);
  downloadCsv(filename, csvData);
}

export function exportAttendanceXlsx(rows: OversightRow[], from: string, to: string) {
  const filename = `attendance-breaks-report-${from}-to-${to}.xlsx`;
  const data = rows.map((r) => {
    const rowObj: Record<string, unknown> = {};
    for (const col of ATTENDANCE_MONITORING_COLUMNS) {
      rowObj[col.header] = neutralizeFormula(col.value(r));
    }
    return rowObj;
  });

  const worksheet = XLSX.utils.json_to_sheet(data);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Attendance & Breaks");
  XLSX.writeFile(workbook, filename);
}
