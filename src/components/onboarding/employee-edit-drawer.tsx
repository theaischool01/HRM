import * as React from "react";
import { useState, useEffect } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
  SheetFooter,
} from "@/components/ui/sheet";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  Lock,
  User,
  Briefcase,
  Calendar,
  ShieldAlert,
} from "lucide-react";
import {
  ONBOARDING_CATEGORIES,
  ONBOARDING_CATEGORY_LABELS,
  ONBOARDING_STATUS_LABELS,
  type OnboardingCategory,
  type OnboardingRawRow,
  type OnboardingRole,
  type ValidatedOnboardingRow,
} from "@/lib/onboarding/employee-onboarding";
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import { ROLE_LABELS, type AppRole } from "@/lib/permissions";

export interface EmployeeEditDrawerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  rawRow: OnboardingRawRow | null;
  validationRow: ValidatedOnboardingRow | null;
  departments: { id: string; name: string; code: string | null }[];
  leads: { id: string; fullName: string; workEmail: string }[];
  assignableRoles: AppRole[];
  onSave: (updated: OnboardingRawRow) => void;
}

export function EmployeeEditDrawer({
  open,
  onOpenChange,
  rawRow,
  validationRow,
  departments,
  leads,
  assignableRoles,
  onSave,
}: EmployeeEditDrawerProps) {
  const [form, setForm] = useState<OnboardingRawRow | null>(null);

  useEffect(() => {
    if (rawRow) {
      setForm({ ...rawRow });
    } else {
      setForm(null);
    }
  }, [rawRow, open]);

  if (!form || !validationRow) return null;

  function updateField(key: keyof OnboardingRawRow, value: string) {
    setForm((prev) => (prev ? { ...prev, [key]: value } : null));
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (form) {
      onSave(form);
      onOpenChange(false);
    }
  }

  const statusVariant =
    validationRow.status === "valid"
      ? "success"
      : validationRow.status === "warning"
        ? "warning"
        : validationRow.status === "needs_information"
          ? "secondary"
          : "destructive";

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:max-w-xl overflow-y-auto flex flex-col gap-0 p-0"
      >
        <SheetHeader className="p-6 border-b border-border bg-muted/30">
          <div className="flex items-center justify-between gap-2 pr-6">
            <SheetTitle className="text-lg flex items-center gap-2">
              <User className="size-5 text-primary" />
              Edit Employee (Row #{validationRow.rowNumber})
            </SheetTitle>
            <Badge variant={statusVariant as "default" | "secondary" | "destructive" | "outline"}>
              {ONBOARDING_STATUS_LABELS[validationRow.status]}
            </Badge>
          </div>
          <SheetDescription className="text-xs">
            Modify details directly in the staging preview. Changes will be validated immediately.
          </SheetDescription>
        </SheetHeader>

        <form onSubmit={handleSave} className="flex-1 flex flex-col justify-between">
          <div className="p-6 space-y-6">
            {/* Section A: Identity */}
            <div className="space-y-4 rounded-lg border border-border p-4 bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/60 pb-2">
                <User className="size-4 text-primary" />
                Section A · Identity
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="first_name" className="text-xs">
                    First Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="first_name"
                    value={form.first_name ?? ""}
                    onChange={(e) => updateField("first_name", e.target.value)}
                    placeholder="e.g. Aarav"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="last_name" className="text-xs">
                    Last Name <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="last_name"
                    value={form.last_name ?? ""}
                    onChange={(e) => updateField("last_name", e.target.value)}
                    placeholder="e.g. Sharma"
                    required
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="work_email" className="text-xs">
                  Work Email <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="work_email"
                  type="email"
                  value={form.work_email ?? ""}
                  onChange={(e) => updateField("work_email", e.target.value)}
                  placeholder="e.g. aarav.sharma@theaischool.co"
                  required
                />
              </div>

              <div className="space-y-1.5">
                <div className="flex items-center justify-between">
                  <Label htmlFor="date_of_birth" className="text-xs">
                    Date of Birth (YYYY-MM-DD) <span className="text-destructive">*</span>
                  </Label>
                  <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                    <Lock className="size-3 text-emerald-600" /> Confidential
                  </span>
                </div>
                <Input
                  id="date_of_birth"
                  value={form.date_of_birth ?? ""}
                  onChange={(e) => updateField("date_of_birth", e.target.value)}
                  placeholder="YYYY-MM-DD (e.g. 2001-05-14)"
                  required
                />
                <p className="text-[11px] text-muted-foreground">
                  Must be between 16 and 80 years old. Stored privately; never exposed in logs or used for passwords.
                </p>
              </div>
            </div>

            {/* Section B: Employment & Role */}
            <div className="space-y-4 rounded-lg border border-border p-4 bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/60 pb-2">
                <Briefcase className="size-4 text-primary" />
                Section B · Employment & Work Type
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="work_type" className="text-xs">
                    Work Type <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.work_type ?? ""}
                    onValueChange={(val) => updateField("work_type", val)}
                  >
                    <SelectTrigger id="work_type">
                      <SelectValue placeholder="Select work type" />
                    </SelectTrigger>
                    <SelectContent>
                      {WORK_TYPES.map((wt) => (
                        <SelectItem key={wt} value={wt}>
                          {WORK_TYPE_LABELS[wt]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="role" className="text-xs">
                    Authorization Role <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.role ?? ""}
                    onValueChange={(val) => updateField("role", val)}
                  >
                    <SelectTrigger id="role">
                      <SelectValue placeholder="Select role" />
                    </SelectTrigger>
                    <SelectContent>
                      {assignableRoles.map((r) => (
                        <SelectItem key={r} value={r}>
                          {ROLE_LABELS[r]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="employment_category" className="text-xs">
                    Employment Category <span className="text-destructive">*</span>
                  </Label>
                  <Select
                    value={form.employment_category ?? ""}
                    onValueChange={(val) => updateField("employment_category", val)}
                  >
                    <SelectTrigger id="employment_category">
                      <SelectValue placeholder="Select category" />
                    </SelectTrigger>
                    <SelectContent>
                      {ONBOARDING_CATEGORIES.map((cat) => (
                        <SelectItem key={cat} value={cat}>
                          {ONBOARDING_CATEGORY_LABELS[cat]}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="department" className="text-xs">
                    Department
                  </Label>
                  <Select
                    value={form.department ?? "_none_"}
                    onValueChange={(val) => updateField("department", val === "_none_" ? "" : val)}
                  >
                    <SelectTrigger id="department">
                      <SelectValue placeholder="Assign department" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="_none_">None / Unassigned</SelectItem>
                      {departments.map((d) => (
                        <SelectItem key={d.id} value={d.name}>
                          {d.name} {d.code ? `(${d.code})` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="designation" className="text-xs">
                  Designation / Job Title <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="designation"
                  value={form.designation ?? ""}
                  onChange={(e) => updateField("designation", e.target.value)}
                  placeholder="e.g. AI Annotation Specialist"
                  required
                />
              </div>
            </div>

            {/* Section C: Reporting & Schedule */}
            <div className="space-y-4 rounded-lg border border-border p-4 bg-card">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/60 pb-2">
                <Calendar className="size-4 text-primary" />
                Section C · Reporting & Schedule
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="reporting_lead_email" className="text-xs">
                  Reporting Lead
                </Label>
                <Select
                  value={form.reporting_lead_email ?? "_none_"}
                  onValueChange={(val) =>
                    updateField("reporting_lead_email", val === "_none_" ? "" : val)
                  }
                >
                  <SelectTrigger id="reporting_lead_email">
                    <SelectValue placeholder="Select reporting lead" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="_none_">None / Assign Later</SelectItem>
                    {leads.map((l) => (
                      <SelectItem key={l.id} value={l.workEmail}>
                        {l.fullName} ({l.workEmail})
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-[11px] text-muted-foreground">
                  Employees without an assigned lead can be provisioned, but leave/WFH requests will remain blocked until HR assigns one.
                </p>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="joining_date" className="text-xs">
                    Joining Date (YYYY-MM-DD)
                  </Label>
                  <Input
                    id="joining_date"
                    value={form.joining_date ?? ""}
                    onChange={(e) => updateField("joining_date", e.target.value)}
                    placeholder="YYYY-MM-DD"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="work_location" className="text-xs">
                    Work Location / Mode
                  </Label>
                  <Select
                    value={form.work_location ?? "remote"}
                    onValueChange={(val) => updateField("work_location", val)}
                  >
                    <SelectTrigger id="work_location">
                      <SelectValue placeholder="Select location" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="remote">Remote</SelectItem>
                      <SelectItem value="onsite">Onsite (Office)</SelectItem>
                      <SelectItem value="hybrid">Hybrid</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {form.employment_category === "intern" && (
                <div className="grid grid-cols-2 gap-3 pt-1 border-t border-border/40">
                  <div className="space-y-1.5">
                    <Label htmlFor="internship_start" className="text-xs">
                      Internship Start
                    </Label>
                    <Input
                      id="internship_start"
                      value={form.internship_start ?? ""}
                      onChange={(e) => updateField("internship_start", e.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="internship_end" className="text-xs">
                      Internship End
                    </Label>
                    <Input
                      id="internship_end"
                      value={form.internship_end ?? ""}
                      onChange={(e) => updateField("internship_end", e.target.value)}
                      placeholder="YYYY-MM-DD"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Section D: Validation Diagnostics */}
            <div className="space-y-3 rounded-lg border border-border p-4 bg-muted/20">
              <div className="flex items-center gap-2 text-sm font-semibold text-foreground border-b border-border/60 pb-2">
                <ShieldAlert className="size-4 text-primary" />
                Section D · Validation Diagnostics
              </div>

              {validationRow.errors.length === 0 && validationRow.warnings.length === 0 && (
                <div className="flex items-center gap-2 text-xs text-emerald-600 bg-emerald-500/10 p-2.5 rounded-md border border-emerald-500/20">
                  <CheckCircle2 className="size-4 shrink-0" />
                  <span>All required fields are complete and valid. Ready for provisioning.</span>
                </div>
              )}

              {validationRow.errors.length > 0 && (
                <div className="space-y-1.5 bg-destructive/10 p-2.5 rounded-md border border-destructive/20 text-xs text-destructive">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertCircle className="size-4 shrink-0" />
                    <span>Blocking Errors ({validationRow.errors.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {validationRow.errors.map((err, i) => (
                      <li key={i}>{err}</li>
                    ))}
                  </ul>
                </div>
              )}

              {validationRow.warnings.length > 0 && (
                <div className="space-y-1.5 bg-amber-500/10 p-2.5 rounded-md border border-amber-500/20 text-xs text-amber-700 dark:text-amber-400">
                  <div className="font-semibold flex items-center gap-1.5">
                    <AlertTriangle className="size-4 shrink-0" />
                    <span>Warnings ({validationRow.warnings.length})</span>
                  </div>
                  <ul className="list-disc pl-5 space-y-0.5">
                    {validationRow.warnings.map((warn, i) => (
                      <li key={i}>{warn}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          </div>

          <SheetFooter className="p-4 border-t border-border bg-muted/30 sticky bottom-0">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit">
              Save Changes
            </Button>
          </SheetFooter>
        </form>
      </SheetContent>
    </Sheet>
  );
}
