import { describe, it, expect } from "vitest";
import {
  evaluateMorningPunctuality,
  evaluateBreakCompliance,
  buildAttendanceTimeline,
  formatMinutesHuman,
} from "../attendance/attendance-monitoring";
import {
  computeDayMetricsInMemory,
  deriveDayStatusInMemory,
  summariseRows,
  type OversightRow,
} from "../oversight.server";
import { neutralizeFormula } from "../csv";

describe("Morning Check-In Punctuality (10:00 AM IST Deadline)", () => {
  const workDate = "2026-11-18";

  it("classifies check-in at 09:45 AM as on_time with 0 minutes late", () => {
    const checkIn = `${workDate}T09:45:00+05:30`;
    const res = evaluateMorningPunctuality(checkIn, workDate);
    expect(res.arrivalStatus).toBe("on_time");
    expect(res.minutesLate).toBe(0);
    expect(res.displayLabel).toBe("On Time");
  });

  it("classifies check-in at exactly 10:00:00 AM as on_time with 0 minutes late", () => {
    const checkIn = `${workDate}T10:00:00+05:30`;
    const res = evaluateMorningPunctuality(checkIn, workDate);
    expect(res.arrivalStatus).toBe("on_time");
    expect(res.minutesLate).toBe(0);
    expect(res.displayLabel).toBe("On Time");
  });

  it("classifies check-in at 10:01:00 AM as late by 1 minute", () => {
    const checkIn = `${workDate}T10:01:00+05:30`;
    const res = evaluateMorningPunctuality(checkIn, workDate);
    expect(res.arrivalStatus).toBe("late");
    expect(res.minutesLate).toBe(1);
    expect(res.displayLabel).toBe("Late (1m)");
  });

  it("classifies check-in at 10:30:00 AM as late by 30 minutes", () => {
    const checkIn = `${workDate}T10:30:00+05:30`;
    const res = evaluateMorningPunctuality(checkIn, workDate);
    expect(res.arrivalStatus).toBe("late");
    expect(res.minutesLate).toBe(30);
    expect(res.displayLabel).toBe("Late (30m)");
  });

  it("classifies missing check-in on a past date as missing_check_in", () => {
    // Evaluating yesterday's date
    const pastDate = "2026-11-17";
    const res = evaluateMorningPunctuality(null, pastDate, new Date("2026-11-18T12:00:00+05:30"));
    expect(res.arrivalStatus).toBe("missing_check_in");
    expect(res.displayLabel).toBe("Missing Check-In");
  });

  it("respects approved leave and holiday exceptions", () => {
    const leaveRes = evaluateMorningPunctuality(null, workDate, new Date(), "leave");
    expect(leaveRes.arrivalStatus).toBe("on_leave");
    expect(leaveRes.displayLabel).toBe("Approved Leave");

    const holidayRes = evaluateMorningPunctuality(null, workDate, new Date(), "holiday");
    expect(holidayRes.arrivalStatus).toBe("holiday");
    expect(holidayRes.displayLabel).toBe("Holiday");
  });
});

describe("Data Integrity & 132.83-Hour Bug Elimination", () => {
  it("never lets unclosed shifts from past dates accumulate continuous multi-day time", () => {
    // Deepak Boorla's real scenario: check-in on Nov 13 at 11:12 AM IST, no checkout, no tasks.
    // When queried on Nov 18, it previously showed 132.83 hours / 7,970 unworked minutes.
    const pastDay = {
      work_date: "2026-11-13",
      check_in_at: "2026-11-13T11:12:00+05:30",
      check_out_at: null,
    };
    const nowMs = new Date("2026-11-18T22:00:00+05:30").getTime();
    const today = "2026-11-18";

    const metrics = computeDayMetricsInMemory(pastDay, [], [], [], nowMs, today);

    // Worked minutes must NOT be ~7,970 minutes (132.83 hours)
    expect(metrics.workedMinutes).toBeLessThan(720); // Less than 12 hours
    expect(metrics.uncoveredMinutes).toBeLessThan(720);
    expect(metrics.workedMinutes).toBe(0); // With zero activity, bounded to start
  });

  it("bounds unclosed past shift to the last verified activity timestamp", () => {
    const pastDay = {
      work_date: "2026-11-13",
      check_in_at: "2026-11-13T10:00:00+05:30",
      check_out_at: null,
    };
    // Verified task entries ending at 16:30 IST (6.5 hours of work = 390 mins)
    const entries = [
      {
        started_at: "2026-11-13T10:00:00+05:30",
        ended_at: "2026-11-13T16:30:00+05:30",
        units_completed: 40,
        status: "submitted",
      },
    ];
    const nowMs = new Date("2026-11-18T22:00:00+05:30").getTime();
    const today = "2026-11-18";

    const metrics = computeDayMetricsInMemory(pastDay, entries, [], [], nowMs, today);

    expect(metrics.workedMinutes).toBe(390); // Exactly 6h 30m
    expect(metrics.taskMinutes).toBe(390);
    expect(metrics.uncoveredMinutes).toBe(0);
  });
});

describe("Break Compliance & Overtime Calculations", () => {
  const workDate = "2026-11-18";

  it("calculates Lunch Break returning on time (at 2:30 PM) with 0 overtime", () => {
    const breaks = [
      {
        id: "b-1",
        category: "lunch",
        started_at: `${workDate}T13:45:00+05:30`,
        ended_at: `${workDate}T14:30:00+05:30`,
        expected_end_at: `${workDate}T14:30:00+05:30`,
        allowed_minutes: 60,
      },
    ];

    const evalResult = evaluateBreakCompliance(breaks, workDate);
    expect(evalResult.lunchBreak).not.toBeNull();
    expect(evalResult.lunchBreak!.durationMinutes).toBe(45);
    expect(evalResult.lunchBreak!.overtimeMinutes).toBe(0);
    expect(evalResult.lunchBreak!.returnStatus).toBe("on_time");
    expect(evalResult.totalBreakOvertimeMinutes).toBe(0);
  });

  it("calculates Lunch Break returning late (at 2:45 PM) with 15 mins overtime", () => {
    const breaks = [
      {
        id: "b-2",
        category: "lunch",
        started_at: `${workDate}T13:30:00+05:30`,
        ended_at: `${workDate}T14:45:00+05:30`,
        expected_end_at: `${workDate}T14:30:00+05:30`,
        allowed_minutes: 60,
      },
    ];

    const evalResult = evaluateBreakCompliance(breaks, workDate);
    expect(evalResult.lunchBreak!.durationMinutes).toBe(75);
    expect(evalResult.lunchBreak!.overtimeMinutes).toBe(15);
    expect(evalResult.lunchBreak!.returnStatus).toBe("late_return");
    expect(evalResult.totalBreakOvertimeMinutes).toBe(15);
    expect(evalResult.breakStatus).toBe("late_return");
  });

  it("calculates Short Break returning late with overtime", () => {
    const breaks = [
      {
        id: "b-3",
        category: "short_break",
        started_at: `${workDate}T16:45:00+05:30`,
        ended_at: `${workDate}T17:10:00+05:30`,
        expected_end_at: `${workDate}T17:00:00+05:30`,
        allowed_minutes: 15,
      },
    ];

    const evalResult = evaluateBreakCompliance(breaks, workDate);
    expect(evalResult.shortBreak!.durationMinutes).toBe(25);
    expect(evalResult.shortBreak!.overtimeMinutes).toBe(10);
    expect(evalResult.shortBreak!.returnStatus).toBe("late_return");
    expect(evalResult.totalBreakOvertimeMinutes).toBe(10);
  });

  it("marks legacy breaks as legacy without flagging violations", () => {
    const breaks = [
      {
        id: "b-legacy",
        category: "lunch",
        started_at: `${workDate}T12:00:00+05:30`,
        ended_at: `${workDate}T13:00:00+05:30`,
        is_legacy: true,
      },
    ];

    const evalResult = evaluateBreakCompliance(breaks, workDate);
    expect(evalResult.lunchBreak!.returnStatus).toBe("legacy");
    expect(evalResult.totalBreakOvertimeMinutes).toBe(0);
  });
});

describe("Timeline Generation", () => {
  it("builds sorted chronological events for check-in and breaks", () => {
    const timeline = buildAttendanceTimeline({
      workDate: "2026-11-18",
      checkInAt: "2026-11-18T09:50:00+05:30",
      checkOutAt: "2026-11-18T18:00:00+05:30",
      arrivalStatus: "on_time",
      minutesLate: 0,
      breaks: [
        {
          id: "b1",
          category: "lunch",
          startedAt: "2026-11-18T13:30:00+05:30",
          endedAt: "2026-11-18T14:30:00+05:30",
          expectedEndAt: "2026-11-18T14:30:00+05:30",
          allowedMinutes: 60,
          durationMinutes: 60,
          overtimeMinutes: 0,
          returnStatus: "on_time",
        },
      ],
    });

    expect(timeline.length).toBe(4); // Check-in, Lunch start, Lunch end, Check-out
    expect(timeline[0]?.type).toBe("check_in");
    expect(timeline[0]?.status).toBe("on_time");
    expect(timeline[1]?.title).toBe("Lunch Break Started");
    expect(timeline[2]?.title).toBe("Lunch Break Ended");
    expect(timeline[3]?.type).toBe("check_out");
  });
});

describe("Non-Annotation Staff Handling", () => {
  it("does not flag non-annotation staff as review_required when task hours are zero", () => {
    const day = {
      work_date: "2026-11-18",
      check_in_at: "2026-11-18T10:00:00+05:30",
      check_out_at: "2026-11-18T18:00:00+05:30",
      required_minutes: 480,
      exception_type: "none",
    };
    const metrics = {
      workedMinutes: 480,
      taskMinutes: 0,
      breakMinutes: 60,
      blockerMinutes: 0,
      coveredMinutes: 60,
      uncoveredMinutes: 420,
      unitsCompleted: 0,
      entryCount: 0,
      unsubmittedEntries: 0,
    };
    // Non-annotation: hourlyLoggingExpected = false
    const status = deriveDayStatusInMemory(day, metrics, "approved", "2026-11-18", false);
    expect(status).toBe("present_complete");
  });
});

describe("CSV Export Formula Injection Neutralization", () => {
  it("escapes potentially malicious formula prefixes in text cells", () => {
    expect(neutralizeFormula("=SUM(A1:A10)")).toBe("'=SUM(A1:A10)");
    expect(neutralizeFormula("+cmd|' /C calc'!A0")).toBe("'+cmd|' /C calc'!A0");
    expect(neutralizeFormula("-10")).toBe("'-10");
    expect(neutralizeFormula("@mention")).toBe("'@mention");
    expect(neutralizeFormula("Normal Employee Name")).toBe("Normal Employee Name");
  });
});

describe("Duration Formatter", () => {
  it("formats minutes into human readable hours and minutes", () => {
    expect(formatMinutesHuman(0)).toBe("0m");
    expect(formatMinutesHuman(45)).toBe("45m");
    expect(formatMinutesHuman(340)).toBe("5h 40m");
    expect(formatMinutesHuman(480)).toBe("8h");
  });
});
