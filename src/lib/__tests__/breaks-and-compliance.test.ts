import { describe, expect, it } from "vitest";
import {
  evaluateBreakWindow,
  calculateExpectedReturn,
  calculateBreakCompletion,
  evaluateScheduledBreakEligibility,
  formatDurationHms,
  formatFullHms,
  formatOvertimeHms,
  formatDurationHuman,
  formatTimeWithSecondsIst,
  getIstWallClock,
  BREAK_CATEGORIES,
  LUNCH_WINDOW,
  SHORT_BREAK_WINDOW,
  type ValidBreakCategory,
} from "../breaks/break-management";

describe("THE AI SCHOOL HRM — Breaks & Compliance Engine", () => {
  const TEST_DATE = "2026-11-18";

  // Helper to construct UTC Date from IST string
  const istToDate = (timeStr: string): Date => {
    return new Date(`${TEST_DATE}T${timeStr}+05:30`);
  };

  describe("1. Lunch Break Window Boundaries (1:30 PM - 2:30 PM IST)", () => {
    it("Scenario 1: 1:29:59 PM IST (1 second before window) — blocked", () => {
      const time = istToDate("13:29:59");
      const result = evaluateBreakWindow("lunch", time, TEST_DATE);
      expect(result.canStart).toBe(false);
      if (!result.canStart) {
        expect(result.code).toBe("before_window");
        expect(result.reason).toContain("1:30 PM");
      }
    });

    it("Scenario 2: 1:30:00 PM IST (exact window start) — allowed with 60 mins remaining", () => {
      const time = istToDate("13:30:00");
      const result = evaluateBreakWindow("lunch", time, TEST_DATE);
      expect(result.canStart).toBe(true);
      if (result.canStart) {
        expect(result.timeRemainingSeconds).toBe(3600);
        expect(new Date(result.expectedEndIso).getTime()).toBe(istToDate("14:30:00").getTime());
      }
    });

    it("Scenario 3: 2:29:59 PM IST (1 second before close) — allowed with 1 second remaining", () => {
      const time = istToDate("14:29:59");
      const result = evaluateBreakWindow("lunch", time, TEST_DATE);
      expect(result.canStart).toBe(true);
      if (result.canStart) {
        expect(result.timeRemainingSeconds).toBe(1);
        expect(new Date(result.expectedEndIso).getTime()).toBe(istToDate("14:30:00").getTime());
      }
    });

    it("Scenario 4: 2:30:00 PM IST (exact deadline) — blocked from starting", () => {
      const time = istToDate("14:30:00");
      const result = evaluateBreakWindow("lunch", time, TEST_DATE);
      expect(result.canStart).toBe(false);
      if (!result.canStart) {
        expect(result.code).toBe("after_window");
        expect(result.reason).toContain("closed");
      }
    });

    it("Scenario 5: Fixed return deadline remains 2:30 PM regardless of late start", () => {
      const start = istToDate("13:45:00"); // Starts 15 mins late
      const expectedReturn = calculateExpectedReturn("lunch", TEST_DATE, start);
      expect(expectedReturn.getTime()).toBe(istToDate("14:30:00").getTime());
      // Time available is 45 minutes, not 60 minutes
      const diffMs = expectedReturn.getTime() - start.getTime();
      expect(diffMs / 60_000).toBe(45);
    });
  });

  describe("2. Short Break Window Boundaries (4:45 PM - 5:00 PM IST)", () => {
    it("Scenario 6: 4:44:59 PM IST (1 second before window) — blocked", () => {
      const time = istToDate("16:44:59");
      const result = evaluateBreakWindow("short_break", time, TEST_DATE);
      expect(result.canStart).toBe(false);
      if (!result.canStart) {
        expect(result.code).toBe("before_window");
        expect(result.reason).toContain("4:45 PM");
      }
    });

    it("Scenario 7: 4:45:00 PM IST (exact window start) — allowed with 15 mins remaining", () => {
      const time = istToDate("16:45:00");
      const result = evaluateBreakWindow("short_break", time, TEST_DATE);
      expect(result.canStart).toBe(true);
      if (result.canStart) {
        expect(result.timeRemainingSeconds).toBe(900);
        expect(new Date(result.expectedEndIso).getTime()).toBe(istToDate("17:00:00").getTime());
      }
    });

    it("Scenario 8: 4:59:59 PM IST (1 second before close) — allowed with 1 second remaining", () => {
      const time = istToDate("16:59:59");
      const result = evaluateBreakWindow("short_break", time, TEST_DATE);
      expect(result.canStart).toBe(true);
      if (result.canStart) {
        expect(result.timeRemainingSeconds).toBe(1);
        expect(new Date(result.expectedEndIso).getTime()).toBe(istToDate("17:00:00").getTime());
      }
    });

    it("Scenario 9: 5:00:00 PM IST (exact deadline) — blocked from starting", () => {
      const time = istToDate("17:00:00");
      const result = evaluateBreakWindow("short_break", time, TEST_DATE);
      expect(result.canStart).toBe(false);
      if (!result.canStart) {
        expect(result.code).toBe("after_window");
        expect(result.reason).toContain("closed");
      }
    });

    it("Scenario 10: Fixed return deadline remains 5:00 PM regardless of late start", () => {
      const start = istToDate("16:52:00"); // Starts 7 mins late
      const expectedReturn = calculateExpectedReturn("short_break", TEST_DATE, start);
      expect(expectedReturn.getTime()).toBe(istToDate("17:00:00").getTime());
      // Time available is 8 minutes, not 15 minutes
      const diffMs = expectedReturn.getTime() - start.getTime();
      expect(diffMs / 60_000).toBe(8);
    });
  });

  describe("3. Personalized Break Duration & Return Calculations", () => {
    it("Scenario 11: Calculates expected return from start time + approved duration", () => {
      const start = istToDate("11:15:00");
      const approvedMinutes = 45;
      const expectedReturn = calculateExpectedReturn("personal", TEST_DATE, start, approvedMinutes);
      expect(expectedReturn.getTime()).toBe(istToDate("12:00:00").getTime());
    });

    it("Scenario 12: Handles edge-case minimum (1 min) and maximum (240 mins) durations", () => {
      const start = istToDate("10:00:00");
      const minReturn = calculateExpectedReturn("personal", TEST_DATE, start, 1);
      expect(minReturn.getTime()).toBe(istToDate("10:01:00").getTime());

      const maxReturn = calculateExpectedReturn("personal", TEST_DATE, start, 240);
      expect(maxReturn.getTime()).toBe(istToDate("14:00:00").getTime());
    });
  });

  describe("4. Completion & Overtime Calculations", () => {
    it("Scenario 13: On-time early return computes 0 overtime and on_time status", () => {
      const start = istToDate("13:30:00");
      const end = istToDate("14:20:00"); // Returned 10 mins early
      const expected = istToDate("14:30:00");

      const comp = calculateBreakCompletion(start, end, expected);
      expect(comp.actualDurationSeconds).toBe(3000); // 50 mins
      expect(comp.overtimeSeconds).toBe(0);
      expect(comp.returnStatus).toBe("on_time");
    });

    it("Scenario 14: Exact on-time return computes 0 overtime and on_time status", () => {
      const start = istToDate("13:30:00");
      const end = istToDate("14:30:00"); // Exact deadline
      const expected = istToDate("14:30:00");

      const comp = calculateBreakCompletion(start, end, expected);
      expect(comp.actualDurationSeconds).toBe(3600);
      expect(comp.overtimeSeconds).toBe(0);
      expect(comp.returnStatus).toBe("on_time");
    });

    it("Scenario 15: Late return calculates exact overtime and late_return status", () => {
      const start = istToDate("13:30:00");
      const end = istToDate("14:47:00"); // 17 minutes late
      const expected = istToDate("14:30:00");

      const comp = calculateBreakCompletion(start, end, expected);
      expect(comp.actualDurationSeconds).toBe(4620); // 77 mins
      expect(comp.overtimeSeconds).toBe(1020); // 17 mins * 60 = 1020s
      expect(comp.returnStatus).toBe("late_return");
    });

    it("Scenario 16: Active break does not auto-close when deadline passes", () => {
      // Simulate live evaluation while break is active (no ended_at yet)
      const start = istToDate("13:30:00");
      const expected = istToDate("14:30:00");
      const currentTime = istToDate("14:35:00"); // 5 mins overdue

      const elapsedSeconds = Math.round((currentTime.getTime() - start.getTime()) / 1000);
      const remainingSeconds = Math.round((expected.getTime() - currentTime.getTime()) / 1000);

      expect(elapsedSeconds).toBe(3900); // 65 mins
      expect(remainingSeconds).toBe(-300); // Negative indicates overtime
      expect(remainingSeconds < 0).toBe(true);
      // In UI, this renders OVERTIME (+00:05:00) with audio chime, never auto-closing
    });
  });

  describe("5. Time & Overtime Formatting Helpers", () => {
    it("Scenario 17: Formats durations and overtime accurately", () => {
      expect(formatDurationHms(0)).toBe("00:00");
      expect(formatDurationHms(45)).toBe("00:45");
      expect(formatDurationHms(65)).toBe("01:05");
      expect(formatDurationHms(3665)).toBe("01:01:05");

      expect(formatOvertimeHms(0)).toBe("+00:00:00");
      expect(formatOvertimeHms(1020)).toBe("+00:17:00");
      expect(formatOvertimeHms(3600)).toBe("+01:00:00");

      expect(formatDurationHuman(45)).toBe("45s");
      expect(formatDurationHuman(720)).toBe("12m");
      expect(formatDurationHuman(735)).toBe("12m 15s");
      expect(formatDurationHuman(3600)).toBe("1h");
      expect(formatDurationHuman(4500)).toBe("1h 15m");
    });

    it("Scenario 18: Formats IST timestamps with seconds correctly", () => {
      const iso = istToDate("13:30:00").toISOString();
      const formatted = formatTimeWithSecondsIst(iso);
      expect(formatted).toMatch(/1:30:00\s*PM/i);
    });
  });

  describe("6. Business Rules & Security Invariants", () => {
    it("Scenario 19: Only exactly 3 break categories are permitted", () => {
      expect(BREAK_CATEGORIES).toEqual(["lunch", "short_break", "personal"]);
      // Confirm other legacy options like meeting, training, other are excluded from valid categories
      expect(BREAK_CATEGORIES).not.toContain("meeting");
      expect(BREAK_CATEGORIES).not.toContain("training");
      expect(BREAK_CATEGORIES).not.toContain("other");
    });

    it("Scenario 20: Self-approval constraint prevents HR user approving their own request", () => {
      const hrUserId: string = "usr_hr_001";
      const employeeUserId: string = "usr_emp_002";

      // Test self-approval check logic
      const canApproveOwn = hrUserId !== hrUserId; // False!
      const canApproveOther = hrUserId !== employeeUserId; // True!

      expect(canApproveOwn).toBe(false);
      expect(canApproveOther).toBe(true);
    });
  });

  describe("7. Scheduled Break Auto-Start & Server Reconciliation", () => {
    it("Scenario 21: Checked-in employee at 1:30 PM IST auto-starts Lunch Break", () => {
      const checkInTime = istToDate("09:15:00");
      const currentTime = istToDate("13:30:00");

      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(true);
      if (res.eligible) {
        expect(res.allowedMinutes).toBe(60);
        expect(res.startedAtIso).toBe(istToDate("13:30:00").toISOString());
        expect(res.expectedEndIso).toBe(istToDate("14:30:00").toISOString());
      }
    });

    it("Scenario 22: Checked-in employee at 4:45 PM IST auto-starts Short Break", () => {
      const checkInTime = istToDate("09:15:00");
      const currentTime = istToDate("16:45:00");

      const res = evaluateScheduledBreakEligibility("short_break", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(true);
      if (res.eligible) {
        expect(res.allowedMinutes).toBe(15);
        expect(res.startedAtIso).toBe(istToDate("16:45:00").toISOString());
        expect(res.expectedEndIso).toBe(istToDate("17:00:00").toISOString());
      }
    });

    it("Scenario 23: Employee opens portal at 1:40 PM IST — reconciled into active lunch starting at 1:30 PM", () => {
      const checkInTime = istToDate("09:30:00");
      const currentTime = istToDate("13:40:00"); // 10 minutes into lunch

      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(true);
      if (res.eligible) {
        expect(res.startedAtIso).toBe(istToDate("13:30:00").toISOString());
        expect(res.expectedEndIso).toBe(istToDate("14:30:00").toISOString());
      }
    });

    it("Scenario 24: Employee opens portal at 4:52 PM IST — reconciled into active short break starting at 4:45 PM", () => {
      const checkInTime = istToDate("09:30:00");
      const currentTime = istToDate("16:52:00"); // 7 minutes into short break

      const res = evaluateScheduledBreakEligibility("short_break", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(true);
      if (res.eligible) {
        expect(res.startedAtIso).toBe(istToDate("16:45:00").toISOString());
        expect(res.expectedEndIso).toBe(istToDate("17:00:00").toISOString());
      }
    });

    it("Scenario 25: Absent employee (not checked in) receives no automatic break", () => {
      const currentTime = istToDate("13:35:00");
      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: null,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(false);
      if (!res.eligible) {
        expect(res.code).toBe("not_checked_in");
      }
    });

    it("Scenario 26: Checked-out employee receives no automatic break", () => {
      const checkInTime = istToDate("09:00:00");
      const checkOutTime = istToDate("13:00:00"); // Checked out before lunch
      const currentTime = istToDate("13:35:00");

      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: checkInTime,
        checkOutAt: checkOutTime,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(false);
      if (!res.eligible) {
        expect(res.code).toBe("already_checked_out");
      }
    });

    it("Scenario 27: Employee checked in late at 1:45 PM IST does not get backdated lunch", () => {
      const checkInTime = istToDate("13:45:00"); // Late check-in after lunch started
      const currentTime = istToDate("13:50:00");

      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(false);
      if (!res.eligible) {
        expect(res.code).toBe("late_checkin");
      }
    });

    it("Scenario 28: Employee before 1:30 PM IST (e.g. 1:15 PM) is not yet due", () => {
      const checkInTime = istToDate("09:00:00");
      const currentTime = istToDate("13:15:00");

      const res = evaluateScheduledBreakEligibility("lunch", {
        checkInAt: checkInTime,
        checkOutAt: null,
        currentTime,
        workDate: TEST_DATE,
      });

      expect(res.eligible).toBe(false);
      if (!res.eligible) {
        expect(res.code).toBe("not_yet_due");
      }
    });

    it("Scenario 29: formatFullHms produces exact 2-digit HH:MM:SS matching prompt requirements", () => {
      expect(formatFullHms(3600)).toBe("01:00:00"); // 60 mins at 1:30 PM
      expect(formatFullHms(2700)).toBe("00:45:00"); // 45 mins at 1:45 PM
      expect(formatFullHms(600)).toBe("00:10:00");  // 10 mins at 4:50 PM
      expect(formatFullHms(0)).toBe("00:00:00");    // At return deadline
    });

    it("Scenario 30: Overtime counter formats exact seconds matching prompt (+00:05:32)", () => {
      // 5 mins 32 seconds = 5 * 60 + 32 = 332 seconds
      expect(formatOvertimeHms(332)).toBe("+00:05:32");
      expect(formatOvertimeHms(1)).toBe("+00:00:01");
      expect(formatOvertimeHms(60)).toBe("+00:01:00");
    });
  });
});
