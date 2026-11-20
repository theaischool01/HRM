import { useState } from "react";
import { toast } from "sonner";
import { UserX } from "lucide-react";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { deactivateEmployee } from "@/lib/workforce.functions";

export type DeactivateEmployeeTarget = {
  id: string;
  fullName: string;
  employeeCode: string | null;
  workEmail: string;
  role: string;
  departmentName: string | null;
} | null;

export type DeactivateEmployeeDialogProps = {
  target: DeactivateEmployeeTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

export function DeactivateEmployeeDialog({
  target,
  open,
  onOpenChange,
  onSuccess,
}: DeactivateEmployeeDialogProps) {
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  if (!target) return null;

  async function handleDeactivate() {
    if (!target) return;
    setSubmitting(true);
    try {
      await deactivateEmployee({ data: { userId: target.id, reason: reason.trim() || null } });
      toast.success(`${target.fullName} (${target.employeeCode ?? target.workEmail}) has been deactivated.`);
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to deactivate employee.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-md">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-amber-100 text-amber-600 dark:bg-amber-950/60 dark:text-amber-400">
              <UserX className="size-5" />
            </div>
            <div>
              <AlertDialogTitle>Deactivate Employee</AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Suspend login access while preserving all employee work records and compliance history.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        <div className="space-y-3.5 py-2">
          <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs space-y-1">
            <div className="font-semibold text-foreground">{target.fullName}</div>
            <div className="flex flex-wrap gap-x-3 text-muted-foreground">
              <span className="font-mono">{target.employeeCode ?? "No ID"}</span>
              <span>{target.workEmail}</span>
              <span>{target.departmentName ?? "Unassigned"}</span>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="deactivate-reason" className="text-xs font-medium">
              Reason for deactivation (optional, recorded in audit log)
            </Label>
            <Textarea
              id="deactivate-reason"
              placeholder="e.g. End of internship, leave of absence, or department transition…"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              className="h-20 text-xs"
            />
          </div>

          <p className="text-[11px] text-muted-foreground">
            Note: This account will no longer appear in active workforce counts. All tasks, attendance days, and KYC
            verification events remain intact for compliance audits. You can reactivate this account at any time.
          </p>
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel disabled={submitting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={submitting}
            onClick={handleDeactivate}
            className="bg-amber-600 hover:bg-amber-700 text-white"
          >
            {submitting ? "Deactivating…" : "Confirm Deactivation"}
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
