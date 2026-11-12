import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { changeMustChangePassword } from "@/lib/workforce.functions";
import { evaluatePasswordPolicy } from "@/lib/password-policy";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export function ForcePasswordChangeDialog({ open }: { open: boolean }) {
  const queryClient = useQueryClient();
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const policy = evaluatePasswordPolicy(newPassword, confirmPassword);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    if (!policy.isValid) {
      const msg = policy.errorMessage ?? "Enter a valid password.";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setBusy(true);
    try {
      await changeMustChangePassword({ data: { newPassword } });
      toast.success("Password successfully updated. Welcome to your portal!");
      await queryClient.invalidateQueries();
    } catch (error) {
      const msg = error instanceof Error ? error.message : "Failed to update password.";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open}>
      <DialogContent
        className="sm:max-w-md [&>button]:hidden"
        onInteractOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="text-lg font-semibold">Change temporary password</DialogTitle>
          <DialogDescription>
            Your account was issued a temporary password by an administrator. Please set your own
            permanent password before accessing the portal.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={onSubmit} className="space-y-3.5 pt-1">
          {formError ? (
            <p
              role="alert"
              className="break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
            >
              {formError}
            </p>
          ) : null}

          <div className="space-y-1.5">
            <Label htmlFor="new-pass" className="text-xs">
              New password (min. 8 characters)
            </Label>
            <div className="relative">
              <Input
                id="new-pass"
                type={showPassword ? "text" : "password"}
                autoComplete="new-password"
                required
                disabled={busy}
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="••••••••"
                minLength={8}
                className="pr-10"
              />
              <button
                type="button"
                disabled={busy}
                aria-label={showPassword ? "Hide password" : "Show password"}
                onClick={() => setShowPassword((prev) => !prev)}
                className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
              >
                {showPassword ? (
                  <EyeOff className="size-4" aria-hidden="true" />
                ) : (
                  <Eye className="size-4" aria-hidden="true" />
                )}
              </button>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="confirm-pass" className="text-xs">
              Confirm new password
            </Label>
            <Input
              id="confirm-pass"
              type={showPassword ? "text" : "password"}
              autoComplete="new-password"
              required
              disabled={busy}
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              minLength={8}
            />
          </div>

          <ul
            aria-label="Password requirements"
            className="space-y-1 rounded-md border border-border/70 bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
          >
            <li className="flex items-center gap-1.5">
              <Check
                aria-hidden="true"
                className={`size-3.5 shrink-0 ${policy.minLengthMet ? "text-emerald-600 dark:text-emerald-400" : "opacity-35"}`}
              />
              <span className={policy.minLengthMet ? "text-foreground" : undefined}>
                At least 8 characters
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <Check
                aria-hidden="true"
                className={`size-3.5 shrink-0 ${policy.hasLetter ? "text-emerald-600 dark:text-emerald-400" : "opacity-35"}`}
              />
              <span className={policy.hasLetter ? "text-foreground" : undefined}>
                Includes at least one letter
              </span>
            </li>
            <li className="flex items-center gap-1.5">
              <Check
                aria-hidden="true"
                className={`size-3.5 shrink-0 ${policy.hasNumberOrSymbol ? "text-emerald-600 dark:text-emerald-400" : "opacity-35"}`}
              />
              <span className={policy.hasNumberOrSymbol ? "text-foreground" : undefined}>
                Includes at least one number or symbol
              </span>
            </li>
          </ul>

          <Button type="submit" disabled={busy} className="w-full">
            {busy ? "Updating password…" : "Save password & proceed"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
