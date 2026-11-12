import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { EmailOtpType } from "@supabase/supabase-js";
import { Check, Eye, EyeOff } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { evaluatePasswordPolicy } from "@/lib/password-policy";
import { Logo } from "@/components/brand/logo";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

export const Route = createFileRoute("/auth_/reset-password")({
  ssr: false,
  head: () => ({
    meta: [{ title: "Set new password | The AI School HRM" }],
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const navigate = useNavigate();
  const [ready, setReady] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const policy = evaluatePasswordPolicy(password, confirmPassword);

  useEffect(() => {
    let cancelled = false;

    async function verifyRecoverySession() {
      try {
        const url = new URL(window.location.href);
        const code = url.searchParams.get("code");
        const tokenHash = url.searchParams.get("token_hash");
        const queryType = url.searchParams.get("type");
        const urlError =
          url.searchParams.get("error_description") || url.searchParams.get("error");

        if (urlError) {
          throw new Error(urlError);
        }

        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code);
          if (error) throw error;
        } else if (tokenHash && queryType) {
          const { error } = await supabase.auth.verifyOtp({
            token_hash: tokenHash,
            type: queryType as EmailOtpType,
          });
          if (error) throw error;
        }

        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        if (!data.session) {
          throw new Error(
            "Your password reset session is missing or expired. Request a new password reset link.",
          );
        }

        if (!cancelled) setReady(true);
      } catch (err) {
        if (!cancelled) {
          setSessionError(
            err instanceof Error ? err.message : "Could not validate password reset link.",
          );
        }
      }
    }

    void verifyRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setFormError(null);
    if (!policy.isValid) {
      const msg = policy.errorMessage ?? "Enter a valid password.";
      setFormError(msg);
      toast.error(msg);
      return;
    }

    setBusy(true);
    try {
      const { error } = await supabase.auth.updateUser({ password });
      if (error) throw error;

      toast.success("Your password has been updated.");
      navigate({ to: "/dashboard", replace: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Could not update password.";
      setFormError(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main
      id="main-content"
      className="flex min-h-screen items-center justify-center bg-background px-4 py-8 sm:py-12"
    >
      <Card className="w-full max-w-sm border-border/80">
        <CardHeader className="space-y-3">
          <Logo className="h-8" />
          <div>
            <CardTitle className="font-display text-xl">Set a new password</CardTitle>
            <CardDescription>
              Choose a strong password for your work account before continuing.
            </CardDescription>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {sessionError ? (
            <div className="space-y-4">
              <p
                role="alert"
                className="break-words rounded-md border border-destructive/40 bg-destructive/10 p-3 text-xs text-destructive"
              >
                {sessionError}
              </p>
              <Button asChild className="w-full">
                <Link to="/auth">Back to sign in</Link>
              </Button>
            </div>
          ) : !ready ? (
            <div
              role="status"
              aria-live="polite"
              className="flex items-center gap-2.5 text-sm text-muted-foreground"
            >
              <span
                aria-hidden="true"
                className="size-4 shrink-0 animate-spin rounded-full border-2 border-primary border-t-transparent"
              />
              <span>Verifying reset token…</span>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="space-y-3.5">
              {formError ? (
                <p
                  role="alert"
                  className="break-words rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive"
                >
                  {formError}
                </p>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="new-password">New password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    type={showPassword ? "text" : "password"}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    disabled={busy}
                    className="pr-10"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
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
                <Label htmlFor="confirm-password">Confirm new password</Label>
                <Input
                  id="confirm-password"
                  type={showPassword ? "text" : "password"}
                  autoComplete="new-password"
                  required
                  minLength={8}
                  disabled={busy}
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
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

              <Button type="submit" className="w-full" disabled={busy}>
                {busy ? "Updating…" : "Save new password"}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
