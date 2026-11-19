import * as React from "react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SlidersHorizontal, Check } from "lucide-react";
import {
  ONBOARDING_CATEGORIES,
  ONBOARDING_CATEGORY_LABELS,
  type OnboardingCategory,
  type OnboardingRawRow,
} from "@/lib/onboarding/employee-onboarding";
import { WORK_TYPES, WORK_TYPE_LABELS, type WorkType } from "@/lib/work-type";
import { ROLE_LABELS, type AppRole } from "@/lib/permissions";

export interface BulkEditDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedCount: number;
  departments: { id: string; name: string; code: string | null }[];
  leads: { id: string; fullName: string; workEmail: string }[];
  assignableRoles: AppRole[];
  onApply: (patch: Partial<OnboardingRawRow>) => void;
}

export function BulkEditDialog({
  open,
  onOpenChange,
  selectedCount,
  departments,
  leads,
  assignableRoles,
  onApply,
}: BulkEditDialogProps) {
  // Enabled toggles for each field
  const [enableWorkType, setEnableWorkType] = useState(false);
  const [workType, setWorkType] = useState<string>("annotation");

  const [enableRole, setEnableRole] = useState(false);
  const [role, setRole] = useState<string>("employee");

  const [enableCategory, setEnableCategory] = useState(false);
  const [category, setCategory] = useState<string>("intern");

  const [enableDesignation, setEnableDesignation] = useState(false);
  const [designation, setDesignation] = useState<string>("");

  const [enableDepartment, setEnableDepartment] = useState(false);
  const [department, setDepartment] = useState<string>("");

  const [enableLead, setEnableLead] = useState(false);
  const [leadEmail, setLeadEmail] = useState<string>("");

  const [enableJoiningDate, setEnableJoiningDate] = useState(false);
  const [joiningDate, setJoiningDate] = useState<string>("");

  const [enableWorkLocation, setEnableWorkLocation] = useState(false);
  const [workLocation, setWorkLocation] = useState<string>("remote");

  const anyEnabled =
    enableWorkType ||
    enableRole ||
    enableCategory ||
    enableDesignation ||
    enableDepartment ||
    enableLead ||
    enableJoiningDate ||
    enableWorkLocation;

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!anyEnabled) return;

    const patch: Partial<OnboardingRawRow> = {};
    if (enableWorkType) patch.work_type = workType;
    if (enableRole) patch.role = role;
    if (enableCategory) patch.employment_category = category;
    if (enableDesignation && designation.trim()) patch.designation = designation.trim();
    if (enableDepartment) patch.department = department;
    if (enableLead) patch.reporting_lead_email = leadEmail;
    if (enableJoiningDate && joiningDate.trim()) patch.joining_date = joiningDate.trim();
    if (enableWorkLocation) patch.work_location = workLocation;

    onApply(patch);
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="size-5 text-primary" />
            Bulk Edit {selectedCount} Selected Employees
          </DialogTitle>
          <DialogDescription className="text-xs">
            Select the fields you wish to update across all {selectedCount} checked rows. Fields left unchecked will remain unchanged.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4 py-2">
          {/* Work Type */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-work-type"
              checked={enableWorkType}
              onCheckedChange={(checked) => setEnableWorkType(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-work-type" className="text-xs font-medium cursor-pointer">
                Work Type
              </Label>
              <Select
                value={workType}
                onValueChange={setWorkType}
                disabled={!enableWorkType}
              >
                <SelectTrigger className="w-full">
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
          </div>

          {/* Authorization Role */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-role"
              checked={enableRole}
              onCheckedChange={(checked) => setEnableRole(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-role" className="text-xs font-medium cursor-pointer">
                Authorization Role
              </Label>
              <Select
                value={role}
                onValueChange={setRole}
                disabled={!enableRole}
              >
                <SelectTrigger className="w-full">
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

          {/* Employment Category */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-category"
              checked={enableCategory}
              onCheckedChange={(checked) => setEnableCategory(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-category" className="text-xs font-medium cursor-pointer">
                Employment Category
              </Label>
              <Select
                value={category}
                onValueChange={setCategory}
                disabled={!enableCategory}
              >
                <SelectTrigger className="w-full">
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
          </div>

          {/* Designation */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-designation"
              checked={enableDesignation}
              onCheckedChange={(checked) => setEnableDesignation(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-designation" className="text-xs font-medium cursor-pointer">
                Designation / Job Title
              </Label>
              <Input
                value={designation}
                onChange={(e) => setDesignation(e.target.value)}
                placeholder="e.g. AI Data Annotation Analyst"
                disabled={!enableDesignation}
              />
            </div>
          </div>

          {/* Department */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-department"
              checked={enableDepartment}
              onCheckedChange={(checked) => setEnableDepartment(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-department" className="text-xs font-medium cursor-pointer">
                Department
              </Label>
              <Select
                value={department}
                onValueChange={setDepartment}
                disabled={!enableDepartment}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select department" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_clear_">None / Clear</SelectItem>
                  {departments.map((d) => (
                    <SelectItem key={d.id} value={d.name}>
                      {d.name} {d.code ? `(${d.code})` : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Reporting Lead */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-lead"
              checked={enableLead}
              onCheckedChange={(checked) => setEnableLead(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-lead" className="text-xs font-medium cursor-pointer">
                Reporting Lead
              </Label>
              <Select
                value={leadEmail}
                onValueChange={setLeadEmail}
                disabled={!enableLead}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Assign reporting lead" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="_clear_">None / Clear</SelectItem>
                  {leads.map((l) => (
                    <SelectItem key={l.id} value={l.workEmail}>
                      {l.fullName} ({l.workEmail})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Joining Date */}
          <div className="flex items-start gap-3 rounded-md border border-border p-3 bg-card/60">
            <Checkbox
              id="chk-joining"
              checked={enableJoiningDate}
              onCheckedChange={(checked) => setEnableJoiningDate(Boolean(checked))}
              className="mt-1"
            />
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="chk-joining" className="text-xs font-medium cursor-pointer">
                Joining Date (YYYY-MM-DD)
              </Label>
              <Input
                value={joiningDate}
                onChange={(e) => setJoiningDate(e.target.value)}
                placeholder="YYYY-MM-DD"
                disabled={!enableJoiningDate}
              />
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={!anyEnabled}>
              <Check className="size-4 mr-1.5" />
              Apply to {selectedCount} Selected Rows
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
