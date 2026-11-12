import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Suspense } from "react";
import { supabase } from "@/integrations/supabase/client";
import { errorToAccessScreen } from "@/components/access-denied";
import { useActor } from "@/hooks/use-actor";
import { ForcePasswordChangeDialog } from "@/components/auth/force-password-change-dialog";

export const Route = createFileRoute("/_authenticated")({
  ssr: false,
  beforeLoad: async () => {
    const { data, error } = await supabase.auth.getUser();
    if (error || !data.user) throw redirect({ to: "/auth" });
    return { user: data.user };
  },
  component: AuthenticatedLayout,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

function AuthenticatedContent() {
  const actor = useActor();
  return (
    <>
      <Outlet />
      <ForcePasswordChangeDialog open={actor.mustChangePassword === true} />
    </>
  );
}

function AuthenticatedLayout() {
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          className="flex min-h-screen flex-col items-center justify-center gap-2 bg-background"
        >
          <div
            aria-hidden="true"
            className="size-6 animate-spin rounded-full border-2 border-primary border-t-transparent"
          />
          <span className="text-xs text-muted-foreground">Loading workspace…</span>
        </div>
      }
    >
      <AuthenticatedContent />
    </Suspense>
  );
}
