import { describe, expect, it } from "vitest";
import { badgeVariants } from "@/components/ui/badge";
import {
  AUTOMATION_HUB_TABS,
  ONBOARDING_HUB_TABS,
  ORG_HUB_TABS,
  OVERSIGHT_HUB_TABS,
  RECRUITMENT_HUB_TABS,
} from "@/components/hub-subnav";
import { buildRoleNavigation, isNavItemActive } from "../navigation";
import { evaluatePasswordPolicy } from "../password-policy";
import {
  normalizeEffectivePermissions,
  PERMISSION_KEYS,
  type Actor,
  type AppRole,
} from "../permissions";
import {
  formatInterviewIstSlot,
  validateCandidateTransition,
} from "../recruitment/pipeline";

function makeActor(roles: AppRole[], rawPerms: string[] = [...PERMISSION_KEYS]): Actor {
  return {
    userId: `user-${roles.join("-")}`,
    fullName: "Test User",
    workEmail: "test@theaischool.co",
    accountStatus: "active",
    category: "full_time",
    roles,
    permissions: normalizeEffectivePermissions(roles, rawPerms),
  };
}

describe("Phase P2.5 — Unified Password Policy Parity", () => {
  it("rejects passwords shorter than 8 characters (closing legacy min-6 mismatch)", () => {
    const sixChars = evaluatePasswordPolicy("Abc12!");
    expect(sixChars.minLengthMet).toBe(false);
    expect(sixChars.isValid).toBe(false);
    expect(sixChars.errorMessage).toBe("Password must be at least 8 characters.");
  });

  it("requires at least one letter and at least one number or symbol", () => {
    const lettersOnly = evaluatePasswordPolicy("abcdefghij");
    expect(lettersOnly.minLengthMet).toBe(true);
    expect(lettersOnly.hasLetter).toBe(true);
    expect(lettersOnly.hasNumberOrSymbol).toBe(false);
    expect(lettersOnly.isValid).toBe(false);

    const digitsOnly = evaluatePasswordPolicy("1234567890");
    expect(digitsOnly.hasLetter).toBe(false);
    expect(digitsOnly.hasNumberOrSymbol).toBe(true);
    expect(digitsOnly.isValid).toBe(false);
  });

  it("validates matching and non-matching confirmation passwords", () => {
    const mismatch = evaluatePasswordPolicy("Secure@531", "Secure@532");
    expect(mismatch.matchesConfirmation).toBe(false);
    expect(mismatch.isValid).toBe(false);
    expect(mismatch.errorMessage).toBe("Passwords do not match.");

    const valid = evaluatePasswordPolicy("Secure@531", "Secure@531");
    expect(valid.minLengthMet).toBe(true);
    expect(valid.hasLetter).toBe(true);
    expect(valid.hasNumberOrSymbol).toBe(true);
    expect(valid.matchesConfirmation).toBe(true);
    expect(valid.isValid).toBe(true);
    expect(valid.errorMessage).toBeNull();
  });
});

describe("Phase P2.5 — Semantic Design System Badge Variants", () => {
  it("provides dark-mode-safe semantic status variants and a non-red default badge", () => {
    const def = badgeVariants({ variant: "default" });
    expect(def).toContain("bg-foreground");
    expect(def).not.toContain("bg-primary");

    const success = badgeVariants({ variant: "success" });
    expect(success).toContain("text-emerald-800");
    expect(success).toContain("dark:text-emerald-300");

    const warning = badgeVariants({ variant: "warning" });
    expect(warning).toContain("text-amber-900");
    expect(warning).toContain("dark:text-amber-300");

    const info = badgeVariants({ variant: "info" });
    expect(info).toContain("text-sky-800");
    expect(info).toContain("dark:text-sky-300");

    const destructive = badgeVariants({ variant: "destructive" });
    expect(destructive).toContain("text-destructive");

    const neutral = badgeVariants({ variant: "neutral" });
    expect(neutral).toContain("text-muted-foreground");
  });
});

describe("Phase P2.5 — Navigation & Section Hub Consistency Across All 7 Roles", () => {
  it("keeps Founder navigation strictly read-only without admin/self-logging routes", () => {
    const founder = makeActor(["founder"]);
    const groups = buildRoleNavigation(founder);
    const urls = groups.flatMap((g) => g.items.map((i) => i.to));

    expect(urls).toContain("/dashboard");
    expect(urls).toContain("/reports");
    expect(urls).toContain("/workforce");
    expect(urls).not.toContain("/invitations");
    expect(urls).not.toContain("/roster-import");
    expect(urls).not.toContain("/org");
    expect(urls).not.toContain("/automation");
    expect(urls).not.toContain("/import");
    expect(urls).not.toContain("/my-day");
    expect(urls).not.toContain("/my-projects");
  });

  it("keeps Employee navigation focused on the 5-item personal workspace", () => {
    const employee = makeActor(
      ["employee"],
      [
        "attendance:log:self",
        "allocations:acknowledge:self",
        "requests:read:self",
        "requests:submit:self",
        "workforce:update:self",
      ],
    );
    const groups = buildRoleNavigation(employee);
    const urls = groups.flatMap((g) => g.items.map((i) => i.to));
    expect(urls).toEqual(["/dashboard", "/my-day", "/my-projects", "/requests", "/onboarding"]);
  });

  it("highlights nested detail routes under their parent sidebar items", () => {
    const hr = makeActor(["hr"]);
    const groups = buildRoleNavigation(hr);
    const candidatesItem = groups
      .flatMap((g) => g.items)
      .find((i) => i.to === "/candidates");
    expect(candidatesItem).toBeDefined();
    expect(isNavItemActive("/candidates/cand-123", candidatesItem!)).toBe(true);
    expect(isNavItemActive("/interviews", candidatesItem!)).toBe(false);
  });

  it("wires all 5 sub-navigation hubs to valid route paths", () => {
    expect(RECRUITMENT_HUB_TABS.map((t) => t.to)).toEqual([
      "/candidates",
      "/interviews",
      "/email-center",
    ]);
    expect(ONBOARDING_HUB_TABS.map((t) => t.to)).toEqual([
      "/invitations",
      "/roster-import",
    ]);
    expect(ORG_HUB_TABS.map((t) => t.to)).toEqual(["/org", "/office-locations"]);
    expect(AUTOMATION_HUB_TABS.map((t) => t.to)).toEqual(["/automation", "/import"]);
    expect(OVERSIGHT_HUB_TABS.map((t) => t.to)).toEqual(["/team", "/reviews"]);
  });
});

describe("Phase P2.5 — Recruitment Stage Guardrails & IST Interview Slot Formatting", () => {
  it("prevents manual stage buttons from jumping directly into onboarding without conversion", () => {
    const directJump = validateCandidateTransition({
      fromStatus: "offer_accepted",
      toStatus: "onboarding",
      viaConversion: false,
    });
    expect(directJump.ok).toBe(false);

    const viaConversion = validateCandidateTransition({
      fromStatus: "offer_accepted",
      toStatus: "onboarding",
      viaConversion: true,
    });
    expect(viaConversion.ok).toBe(true);
  });

  it("formats explicit IST (+05:30) interview start/end slots consistently regardless of host TZ", () => {
    const startUtc = new Date("2026-11-15T11:00:00+05:30").toISOString();
    const endUtc = new Date("2026-11-15T11:45:00+05:30").toISOString();
    const formatted = formatInterviewIstSlot(startUtc, endUtc);
    expect(formatted.dateLabel).toContain("Nov");
    expect(formatted.dateLabel).toContain("2026");
    expect(formatted.timeRangeLabel).toContain("11:00");
    expect(formatted.timeRangeLabel).toContain("11:45");
    expect(formatted.timeRangeLabel.endsWith("IST")).toBe(true);
  });
});

