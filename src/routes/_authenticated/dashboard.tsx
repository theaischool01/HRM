import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AppShell } from "@/components/app-shell";
import {
  DashboardErrorState,
  DashboardLoadingSkeleton,
} from "@/components/dashboard/dashboard-widgets";
import { RoleDashboardView } from "@/components/dashboard/role-dashboards";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { markNotificationRead } from "@/lib/daily.functions";
import { getRoleDashboard } from "@/lib/dashboard.functions";
import { ROLE_LABELS, resolvePrimaryRole } from "@/lib/permissions";

export const Route = createFileRoute("/_authenticated/dashboard")({
  head: () => ({
    meta: [
      { title: "Dashboard | The AI School HRM" },
      {
        name: "description",
        content: "Role-tailored workforce, attendance, delivery and governance dashboard.",
      },
      { property: "og:title", content: "Dashboard | The AI School HRM" },
      { property: "og:description", content: "Workforce overview and pending actions." },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: DashboardPage,
});

function DashboardPage() {
  const actor = useActor();
  const queryClient = useQueryClient();
  const primaryRole = resolvePrimaryRole(actor.roles);

  const dashboardQuery = useQuery({
    queryKey: ["role-dashboard", actor.userId],
    queryFn: () => getRoleDashboard(),
    staleTime: 30_000,
  });

  const markReadMutation = useMutation({
    mutationFn: (id: string) => markNotificationRead({ data: { id } }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["role-dashboard", actor.userId] });
      queryClient.invalidateQueries({ queryKey: ["my-notifications"] });
    },
  });

  const markingNotificationId = markReadMutation.isPending
    ? (markReadMutation.variables ?? null)
    : null;

  return (
    <AppShell
      title={`${ROLE_LABELS[primaryRole]} Dashboard`}
      description="Live organization, team, and personal metrics scoped to your role."
    >
      {dashboardQuery.isPending ? (
        <DashboardLoadingSkeleton />
      ) : dashboardQuery.isError ? (
        <DashboardErrorState
          message={
            dashboardQuery.error instanceof Error
              ? dashboardQuery.error.message
              : "Failed to load dashboard data."
          }
          isRetrying={dashboardQuery.isFetching}
          onRetry={() => dashboardQuery.refetch()}
        />
      ) : (
        <RoleDashboardView
          data={dashboardQuery.data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={(id) => markReadMutation.mutate(id)}
        />
      )}
    </AppShell>
  );
}
