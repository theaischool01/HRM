import { useEffect, useState } from "react";
import { toast } from "sonner";
import { AlertCircle, ShieldAlert, Trash2 } from "lucide-react";
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
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkEmployeeDeletionEligibility,
  permanentlyDeleteEmployee,
} from "@/lib/workforce.functions";

export type DeleteEmployeeTarget = {
  id: string;
  fullName: string;
  employeeCode: string | null;
  workEmail: string;
} | null;

export type DeleteEmployeeDialogProps = {
  target: DeleteEmployeeTarget;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: () => void;
};

type EligibilityState = Awaited<ReturnType<typeof checkEmployeeDeletionEligibility>>;

export function DeleteEmployeeDialog({
  target,
  open,
  onOpenChange,
  onSuccess,
}: DeleteEmployeeDialogProps) {
  const [eligibility, setEligibility] = useState<EligibilityState | null>(null);
  const [checking, setChecking] = useState(false);
  const [confirmationInput, setConfirmationInput] = useState("");
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (open && target) {
      setChecking(true);
      setConfirmationInput("");
      setEligibility(null);
      checkEmployeeDeletionEligibility({ data: { userId: target.id } })
        .then((res) => setEligibility(res))
        .catch((err) => {
          toast.error(err instanceof Error ? err.message : "Could not evaluate deletion eligibility.");
          onOpenChange(false);
        })
        .finally(() => setChecking(false));
    }
  }, [open, target]);

  if (!target) return null;

  const expectedCode = (eligibility?.employeeCode || target.employeeCode || "").toLowerCase().trim();
  const expectedEmail = (eligibility?.workEmail || target.workEmail || "").toLowerCase().trim();
  const entered = confirmationInput.toLowerCase().trim();
  const isConfirmed = Boolean(
    (expectedCode && entered === expectedCode) || (expectedEmail && entered === expectedEmail),
  );

  async function handleDelete() {
    if (!target || !isConfirmed) return;
    setDeleting(true);
    try {
      await permanentlyDeleteEmployee({
        data: { userId: target.id, confirmation: confirmationInput.trim() },
      });
      toast.success(`Account for ${target.fullName} (${target.employeeCode ?? target.workEmail}) has been permanently deleted.`);
      onOpenChange(false);
      onSuccess();
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : "Failed to permanently delete employee.");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent className="sm:max-w-lg border-red-200 dark:border-red-900/60">
        <AlertDialogHeader>
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-full bg-red-100 text-red-600 dark:bg-red-950/60 dark:text-red-400">
              <ShieldAlert className="size-5" />
            </div>
            <div>
              <AlertDialogTitle className="text-red-600 dark:text-red-400">
                Permanently Delete Employee Account
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Irreversible destructive operation. Requires explicit dependency verification.
              </AlertDialogDescription>
            </div>
          </div>
        </AlertDialogHeader>

        {checking ? (
          <div className="py-6 text-center text-xs text-muted-foreground animate-pulse">
            Analyzing database dependencies and compliance integrity…
          </div>
        ) : eligibility && !eligibility.canDelete ? (
          <div className="space-y-3.5 py-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3.5 text-xs text-red-900 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300 space-y-2">
              <div className="flex items-start gap-2 font-semibold">
                <AlertCircle className="size-4 shrink-0 text-red-600 mt-0.5" />
                <span>Permanent Deletion Blocked</span>
              </div>
              <p className="pl-6 text-[11px] leading-relaxed">{eligibility.blockReason}</p>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs space-y-1">
              <div className="font-semibold text-foreground">{target.fullName}</div>
              <div className="flex gap-3 text-muted-foreground">
                <span className="font-mono">{target.employeeCode ?? "No ID"}</span>
                <span>{target.workEmail}</span>
              </div>
            </div>

            <p className="text-[11px] text-muted-foreground">
              To safeguard legal audit records, staff with recorded work days or team management duties cannot be deleted.
              Use <strong>Deactivate Employee</strong> instead to revoke access safely.
            </p>
          </div>
        ) : (
          <div className="space-y-3.5 py-2">
            <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs text-red-800 dark:border-red-900/60 dark:bg-red-950/40 dark:text-red-300">
              <p className="font-semibold">Warning: This action cannot be undone.</p>
              <p className="mt-1 text-[11px]">
                This will permanently remove the employee profile, assigned roles, and authentication login.
              </p>
            </div>

            <div className="rounded-lg border border-border/70 bg-muted/40 p-3 text-xs space-y-1">
              <div className="font-semibold text-foreground">{target.fullName}</div>
              <div className="flex gap-3 text-muted-foreground">
                <span className="font-mono">{target.employeeCode ?? "No ID"}</span>
                <span>{target.workEmail}</span>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="delete-confirm-input" className="text-xs font-medium">
                To confirm, type{" "}
                <code className="rounded bg-muted px-1.5 py-0.5 font-mono font-bold text-foreground">
                  {target.employeeCode || target.workEmail}
                </code>{" "}
                below:
              </Label>
              <Input
                id="delete-confirm-input"
                placeholder={target.employeeCode || target.workEmail}
                value={confirmationInput}
                onChange={(e) => setConfirmationInput(e.target.value)}
                className="h-9 font-mono text-xs"
                autoFocus
              />
            </div>
          </div>
        )}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>Cancel</AlertDialogCancel>
          <Button
            type="button"
            variant="destructive"
            disabled={checking || !eligibility?.canDelete || !isConfirmed || deleting}
            onClick={handleDelete}
            className="bg-red-600 hover:bg-red-700 text-white gap-1.5"
          >
            <Trash2 className="size-3.5" aria-hidden="true" />
            <span>{deleting ? "Deleting Account…" : "Permanently Delete"}</span>
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
