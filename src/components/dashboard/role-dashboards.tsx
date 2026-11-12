import { Link } from "@tanstack/react-router";
import {
  AlarmClock,
  AlertTriangle,
  BarChart3,
  Bot,
  Briefcase,
  Building2,
  CalendarClock,
  CheckCircle2,
  ClipboardCheck,
  Eye,
  FileCheck2,
  FolderKanban,
  ListChecks,
  MailPlus,
  MapPin,
  ShieldCheck,
  UserCircle2,
  Users,
  UsersRound,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { RoleDashboardData } from "@/lib/dashboard.functions";
import {
  ACCOUNT_STATUS_LABELS,
  CATEGORY_LABELS,
  ROLE_LABELS,
} from "@/lib/permissions";
import {
  ActivityFeedCard,
  AttendanceSummaryPanel,
  DashboardEmptyState,
  KpiCard,
  KpiGrid,
  NotificationsSummaryCard,
  PendingActionQueue,
  ProjectPerformanceCard,
  QuickActionsBar,
  RecruitmentPipelinePanel,
  TeamProductivityCard,
  WorkforceDistributionCard,
} from "./dashboard-widgets";

function formatHoursMinutes(totalMinutes: number): string {
  const h = Math.floor(totalMinutes / 60);
  const m = totalMinutes % 60;
  return `${h}h ${m}m`;
}

function DashboardRoleHeader({
  data,
  subtitle,
  readOnlyBadge = false,
}: {
  data: RoleDashboardData;
  subtitle: string;
  readOnlyBadge?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-4 border-b border-border pb-4">
      <div className="space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs uppercase tracking-wider text-muted-foreground">
            {ROLE_LABELS[data.actor.primaryRole]} Workspace · {data.today} (IST)
          </span>
          {readOnlyBadge && (
            <Badge variant="outline" className="border-info/40 bg-info/10 text-info">
              <Eye className="mr-1 size-3" />
              Read-Only Executive Oversight
            </Badge>
          )}
          {!data.actor.executiveGovernanceOnly && (
            <Badge variant="secondary" className="text-xs">
              {CATEGORY_LABELS[data.actor.category]}
            </Badge>
          )}
        </div>
        <h2 className="font-display text-xl font-bold tracking-tight text-foreground sm:text-2xl">
          Welcome, {data.actor.fullName}
        </h2>
        <p className="max-w-2xl text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {data.actor.canExport && (
        <Button asChild variant="outline" size="sm" className="w-full sm:w-auto">
          <Link to="/reports">
            <BarChart3 className="mr-1.5 size-4" aria-hidden="true" />
            Reports &amp; CSV Exports
          </Link>
        </Button>
      )}
    </div>
  );
}

function PersonalShiftQuickStrip({ data }: { data: RoleDashboardData }) {
  const p = data.personal;
  return (
    <div className="flex flex-col justify-between gap-3 rounded-lg border border-border bg-card px-4 py-3 sm:flex-row sm:items-center">
      <div className="flex min-w-0 items-start gap-3 text-sm sm:items-center">
        <span className="inline-flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/12 text-primary">
          <AlarmClock className="size-4" aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            Your shift today:{" "}
            {p.checkedIn
              ? p.checkedOut
                ? `Checked out (${formatHoursMinutes(p.workedMinutes)})`
                : `Checked in · ${p.workMode?.toUpperCase() ?? "ACTIVE"} (${formatHoursMinutes(p.workedMinutes)})`
              : "Not checked in yet"}
          </p>
          <p className="text-xs text-muted-foreground">
            {p.taskCounts.total} task entries logged · EOD:{" "}
            {p.eodStatus ? p.eodStatus.replace(/_/g, " ") : "not started"}
          </p>
        </div>
      </div>
      <Button
        asChild
        size="sm"
        variant={p.checkedIn ? "outline" : "default"}
        className="w-full shrink-0 sm:w-auto"
      >
        <Link to="/my-day">{p.checkedIn ? "Open My Day" : "Check in now"}</Link>
      </Button>
    </div>
  );
}

function ComplianceAndSystemHealthCard({
  data,
  showSecurityStats = false,
}: {
  data: RoleDashboardData;
  showSecurityStats?: boolean;
}) {
  const g = data.governance;
  const totalFlags =
    g.unresolvedFlagsBySeverity.critical +
    g.unresolvedFlagsBySeverity.warning +
    g.unresolvedFlagsBySeverity.info;

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <ShieldCheck className="size-4 text-primary" />
            <CardTitle className="font-display text-base font-semibold">
              {showSecurityStats
                ? "Security, Geofence & Automation Health"
                : "Operational Compliance & Geofences"}
            </CardTitle>
          </div>
          <Button asChild variant="outline" size="sm">
            <Link to="/automation">Open automation</Link>
          </Button>
        </div>
        <CardDescription>
          Real-time compliance flags, office geofence readiness, and scheduled worker state
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid grid-cols-2 gap-2.5 text-xs 2xl:grid-cols-4">
          <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
            <span className="text-muted-foreground">Active Geofences</span>
            <p className="mt-0.5 font-mono text-base font-semibold">
              {g.activeOfficesCount} / {g.totalOfficesCount}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
            <span className="text-muted-foreground">Geofence Alerts Today</span>
            <p className="mt-0.5 font-mono text-base font-semibold text-warning">
              {data.attendance.geofenceMismatchToday}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
            <span className="text-muted-foreground">Unresolved Flags</span>
            <p className="mt-0.5 font-mono text-base font-semibold">
              {totalFlags}{" "}
              {g.unresolvedFlagsBySeverity.critical > 0 && (
                <span className="text-xs text-destructive">
                  ({g.unresolvedFlagsBySeverity.critical} crit)
                </span>
              )}
            </p>
          </div>
          <div className="rounded-md border border-border/70 bg-muted/20 p-2.5">
            <span className="text-muted-foreground">Last Worker Run</span>
            <p className="mt-0.5 break-words font-mono text-xs font-semibold">
              {g.latestAutomationRun
                ? `${g.latestAutomationRun.skipped ? "skipped" : "completed"} (${g.latestAutomationRun.started_at.slice(5, 16).replace("T", " ")})`
                : "No runs yet"}
            </p>
          </div>
        </div>

        {showSecurityStats && (
          <div className="grid gap-2 text-xs sm:grid-cols-2">
            <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground">Forced password resets pending</span>
              <strong className="font-mono">{data.workforce.mustChangePasswordCount}</strong>
            </div>
            <div className="flex items-center justify-between gap-2 rounded-md border border-border px-3 py-2">
              <span className="text-muted-foreground">P0 Scoped Schema Migration</span>
              <Badge variant={data.scope.p0SchemaReady ? "success" : "warning"}>
                {data.scope.p0SchemaReady ? "Applied" : "Compat Mode Active"}
              </Badge>
            </div>
          </div>
        )}

        {g.unresolvedFlagsSample.length > 0 && (
          <div className="space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              Recent unresolved compliance flags
            </p>
            <ul className="space-y-1.5 text-xs">
              {g.unresolvedFlagsSample.slice(0, 4).map((f) => (
                <li
                  key={f.id}
                  className="flex items-center justify-between gap-2 rounded border border-border/70 px-2.5 py-1.5"
                >
                  <span className="truncate">
                    <strong>{f.userName}</strong>: {f.message}
                  </span>
                  <span className="shrink-0 font-mono text-muted-foreground">{f.workDate}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

/* ============================================================================
 * 1. SUPER ADMIN DASHBOARD
 * ========================================================================== */
function SuperAdminDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  const onboardingPipelineCount =
    (data.workforce.statusBreakdown["invited"] ?? 0) +
    (data.workforce.statusBreakdown["activated"] ?? 0) +
    (data.workforce.statusBreakdown["profile_pending"] ?? 0) +
    (data.workforce.statusBreakdown["under_verification"] ?? 0);

  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle="Complete organization-wide governance across workforce lifecycle, RBAC security, attendance, delivery health, compliance automation, and audit trails."
      />

      <KpiGrid>
        <KpiCard
          label="Active Workforce"
          value={data.workforce.activeCount}
          hint={`${onboardingPipelineCount} in onboarding pipeline`}
          icon={Users}
          tone="primary"
          href="/workforce"
        />
        <KpiCard
          label="Checked In Today"
          value={`${data.attendance.checkedInToday} / ${data.attendance.expectedActiveCount}`}
          hint={`${data.attendance.wfoToday} WFO · ${data.attendance.wfhToday} WFH · ${data.attendance.onLeaveToday} Leave`}
          icon={AlarmClock}
          tone="success"
          href="/team"
        />
        <KpiCard
          label="Active Projects"
          value={data.projects.activeCount}
          hint={`${data.projects.unallocatedActiveStaff} unallocated active staff`}
          icon={FolderKanban}
          tone="info"
          href="/projects"
        />
        <KpiCard
          label="Action & Escalation Queue"
          value={data.queues.totalPending}
          hint={`${data.workforce.pendingKycDocumentsCount} KYC docs · ${data.queues.escalatedEodsCount} escalations`}
          icon={AlertTriangle}
          tone={data.queues.totalPending > 0 ? "warning" : "default"}
          href="/requests"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: "Workforce & Roles",
            description: "Manage accounts, roles & KYC",
            to: "/workforce",
            icon: Users,
            tone: "primary",
          },
          {
            label: "Onboarding & Invites",
            description: `${data.governance.invitationsTotal} total invitations`,
            to: "/invitations",
            icon: MailPlus,
            tone: "info",
          },
          {
            label: "Org & Geofences",
            description: "Departments, calendar & offices",
            to: "/org",
            icon: Building2,
            tone: "success",
          },
          {
            label: "Compliance Automation",
            description: "Run checks & inspect flags",
            to: "/automation",
            icon: Bot,
            tone: "warning",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AttendanceSummaryPanel
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
        <PendingActionQueue
          title="Governance & escalation queue"
          description="KYC verifications, HR/Lead approvals, blockers, and escalated EODs"
          items={data.queues.items}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <WorkforceDistributionCard
          totalActive={data.workforce.activeCount}
          categoryBreakdown={data.workforce.categoryBreakdown}
          departmentBreakdown={data.workforce.departmentBreakdown}
          upcomingInternshipEndings={data.workforce.upcomingInternshipEndings}
          missingReportingLeadCount={data.workforce.missingReportingLeadCount}
        />
        <ComplianceAndSystemHealthCard data={data} showSecurityStats />
      </div>

      <ProjectPerformanceCard
        projects={data.projects.portfolio}
        unallocatedActiveStaff={data.projects.unallocatedActiveStaff}
        overAllocatedStaff={data.projects.overAllocatedStaff}
      />

      <RecruitmentPipelinePanel
        schemaReady={data.recruitment.schemaReady}
        emailProviderConfigured={data.recruitment.emailProviderConfigured}
        kpis={data.recruitment.kpis}
        invitationCounts={data.governance.invitationCounts}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeedCard
          title="Recent security & audit activity"
          description="Latest immutable events from public.audit_logs"
          items={data.governance.auditFeed}
          emptyTitle="No recent audit events"
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 2. FOUNDER DASHBOARD (STRICTLY READ-ONLY)
 * ========================================================================== */
function FounderDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        readOnlyBadge
        subtitle="Organization-wide executive visibility into attendance trends, workforce distribution, project delivery, and exportable performance reports."
      />

      <KpiGrid>
        <KpiCard
          label="Active Workforce"
          value={data.workforce.activeCount}
          hint={`${data.workforce.totalVisible} total profiles registered`}
          icon={Users}
          tone="primary"
          href="/workforce"
        />
        <KpiCard
          label="Organization Attendance Today"
          value={`${data.attendance.checkedInToday} / ${data.attendance.expectedActiveCount}`}
          hint={`${data.attendance.wfoToday} WFO · ${data.attendance.wfhToday} WFH · ${data.attendance.onLeaveToday} On Leave`}
          icon={AlarmClock}
          tone="success"
          href="/team"
        />
        <KpiCard
          label="Active Projects"
          value={data.projects.activeCount}
          hint={`${data.projects.totalVisible} total projects in portfolio`}
          icon={FolderKanban}
          tone="info"
          href="/projects"
        />
        <KpiCard
          label="14-Day Avg Achievement"
          value={
            data.attendance.summary14d.avgAchievementPct != null
              ? `${data.attendance.summary14d.avgAchievementPct}%`
              : "—"
          }
          hint={`${data.attendance.summary14d.unitsCompleted.toLocaleString()} units across ${data.attendance.summary14d.workedHours}h`}
          icon={BarChart3}
          tone="primary"
          href="/reports"
        />
      </KpiGrid>

      <QuickActionsBar
        title="Executive inspection & exports"
        actions={[
          {
            label: "Reports & CSV Exports",
            description: "Download attendance & delivery CSVs",
            to: "/reports",
            icon: BarChart3,
            tone: "primary",
          },
          {
            label: "Attendance & EOD Oversight",
            description: "Read-only organization delivery view",
            to: "/team",
            icon: UsersRound,
            tone: "success",
          },
          {
            label: "Project Portfolio",
            description: "Headcount coverage & targets",
            to: "/projects",
            icon: FolderKanban,
            tone: "info",
          },
          {
            label: "Workforce Directory",
            description: "Inspect teams & reporting structure",
            to: "/workforce",
            icon: Users,
            tone: "default",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AttendanceSummaryPanel
          title="Organization attendance & 14-day trend"
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
        <WorkforceDistributionCard
          readOnly
          totalActive={data.workforce.activeCount}
          categoryBreakdown={data.workforce.categoryBreakdown}
          departmentBreakdown={data.workforce.departmentBreakdown}
          upcomingInternshipEndings={data.workforce.upcomingInternshipEndings}
          missingReportingLeadCount={data.workforce.missingReportingLeadCount}
        />
      </div>

      <ProjectPerformanceCard
        readOnly
        projects={data.projects.portfolio}
        unallocatedActiveStaff={data.projects.unallocatedActiveStaff}
        overAllocatedStaff={data.projects.overAllocatedStaff}
      />

      <RecruitmentPipelinePanel
        readOnly
        canViewInvitations={false}
        schemaReady={data.recruitment.schemaReady}
        emailProviderConfigured={data.recruitment.emailProviderConfigured}
        kpis={data.recruitment.kpis}
        invitationCounts={data.governance.invitationCounts}
      />

      <TeamProductivityCard
        title="Workforce productivity snapshot (14 days)"
        description="Read-only attendance and target achievement across active staff"
        members={data.teamProductivity}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeedCard
          title="Announcements & upcoming holidays"
          items={data.orgUpdatesFeed}
          emptyTitle="No published announcements or upcoming holidays"
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 3. HR DASHBOARD
 * ========================================================================== */
function HrDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  const onboardingCount =
    (data.workforce.statusBreakdown["invited"] ?? 0) +
    (data.workforce.statusBreakdown["activated"] ?? 0) +
    (data.workforce.statusBreakdown["profile_pending"] ?? 0) +
    (data.workforce.statusBreakdown["under_verification"] ?? 0);

  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle="Employee lifecycle management, KYC document verification, HR-stage leave/WFH/correction approvals, invitations, and role governance."
      />

      <KpiGrid>
        <KpiCard
          label="Active Workforce"
          value={data.workforce.activeCount}
          hint={`${data.workforce.totalVisible} total profiles in directory`}
          icon={Users}
          tone="primary"
          href="/workforce"
        />
        <KpiCard
          label="Pending KYC Documents"
          value={data.workforce.pendingKycDocumentsCount}
          hint={`${data.workforce.underVerificationProfiles.length} profile(s) awaiting verification`}
          icon={FileCheck2}
          tone={data.workforce.pendingKycDocumentsCount > 0 ? "warning" : "success"}
          href="/workforce"
        />
        <KpiCard
          label="HR Stage Approvals"
          value={data.queues.pendingHrRequestsCount}
          hint="Leave, WFH & attendance corrections"
          icon={CalendarClock}
          tone={data.queues.pendingHrRequestsCount > 0 ? "info" : "default"}
          href="/requests"
        />
        <KpiCard
          label="Onboarding Pipeline"
          value={onboardingCount}
          hint={`${data.governance.invitationCounts["queued"] ?? 0} queued · ${data.governance.invitationCounts["sent"] ?? 0} sent invites`}
          icon={MailPlus}
          tone="primary"
          href="/invitations"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: "Candidates & ATS",
            description: `${data.recruitment.kpis.totalCandidates} candidates in pipeline`,
            to: "/candidates",
            icon: Briefcase,
            tone: "primary",
          },
          {
            label: "Interviews",
            description: `${data.recruitment.kpis.interviewsScheduled} scheduled rounds`,
            to: "/interviews",
            icon: CalendarClock,
            tone: "info",
          },
          {
            label: "HR Email Center",
            description: "12 templates & delivery logs",
            to: "/email-center",
            icon: MailPlus,
            tone: "success",
          },
          {
            label: "Onboarding & Workforce",
            description: "Invites, KYC & employee roles",
            to: "/invitations",
            icon: Users,
            tone: "warning",
          },
        ]}
      />

      <RecruitmentPipelinePanel
        schemaReady={data.recruitment.schemaReady}
        emailProviderConfigured={data.recruitment.emailProviderConfigured}
        kpis={data.recruitment.kpis}
        invitationCounts={data.governance.invitationCounts}
      />

      <PendingActionQueue
        title="HR verification & approval queue"
        description="Pending KYC document reviews and HR-stage employee requests"
        items={data.queues.items}
        emptyMessage="No pending KYC documents or HR-stage requests."
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <WorkforceDistributionCard
          totalActive={data.workforce.activeCount}
          categoryBreakdown={data.workforce.categoryBreakdown}
          departmentBreakdown={data.workforce.departmentBreakdown}
          upcomingInternshipEndings={data.workforce.upcomingInternshipEndings}
          missingReportingLeadCount={data.workforce.missingReportingLeadCount}
        />
        <AttendanceSummaryPanel
          title="Organization attendance today"
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeedCard
          title="Announcements & upcoming holidays"
          items={data.orgUpdatesFeed}
          emptyTitle="No published announcements or upcoming holidays"
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 4. ADMIN DASHBOARD
 * ========================================================================== */
function AdminDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  const totalFlags =
    data.governance.unresolvedFlagsBySeverity.critical +
    data.governance.unresolvedFlagsBySeverity.warning +
    data.governance.unresolvedFlagsBySeverity.info;

  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle="Operational command center for daily attendance, project allocations, office geofences, compliance automation, and escalated delivery reviews."
      />

      <KpiGrid>
        <KpiCard
          label="Checked In Today"
          value={`${data.attendance.checkedInToday} / ${data.attendance.expectedActiveCount}`}
          hint={`${data.attendance.uncheckedInToday} unchecked-in · ${data.attendance.geofenceMismatchToday} geofence alerts`}
          icon={AlarmClock}
          tone="primary"
          href="/team"
        />
        <KpiCard
          label="Active Projects"
          value={data.projects.activeCount}
          hint={`${data.projects.totalVisible} total projects`}
          icon={FolderKanban}
          tone="info"
          href="/projects"
        />
        <KpiCard
          label="Unallocated Staff"
          value={data.projects.unallocatedActiveStaff}
          hint={`${data.projects.overAllocatedStaff} over-allocated (>100%)`}
          icon={Users}
          tone={data.projects.unallocatedActiveStaff > 0 ? "warning" : "success"}
          href="/workforce"
        />
        <KpiCard
          label="Compliance & Escalations"
          value={totalFlags + data.queues.escalatedEodsCount + data.queues.openBlockersCount}
          hint={`${totalFlags} automation flags · ${data.queues.openBlockersCount} open blockers`}
          icon={AlertTriangle}
          tone={
            totalFlags + data.queues.escalatedEodsCount > 0 ? "danger" : "success"
          }
          href="/automation"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: "Projects & Capacity",
            description: "Manage projects & allocations",
            to: "/projects",
            icon: FolderKanban,
            tone: "primary",
          },
          {
            label: "Attendance & EODs",
            description: "Daily operational oversight",
            to: "/team",
            icon: UsersRound,
            tone: "success",
          },
          {
            label: "Office Geofences",
            description: `${data.governance.activeOfficesCount} active geofence zones`,
            to: "/office-locations",
            icon: MapPin,
            tone: "info",
          },
          {
            label: "Automation & Imports",
            description: "Compliance worker & attendance CSVs",
            to: "/automation",
            icon: Bot,
            tone: "warning",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AttendanceSummaryPanel
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
        <ComplianceAndSystemHealthCard data={data} />
      </div>

      <ProjectPerformanceCard
        projects={data.projects.portfolio}
        unallocatedActiveStaff={data.projects.unallocatedActiveStaff}
        overAllocatedStaff={data.projects.overAllocatedStaff}
      />

      <RecruitmentPipelinePanel
        readOnly
        canViewInvitations
        schemaReady={data.recruitment.schemaReady}
        emailProviderConfigured={data.recruitment.emailProviderConfigured}
        kpis={data.recruitment.kpis}
        invitationCounts={data.governance.invitationCounts}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PendingActionQueue
          title="Operational escalations & reviews"
          description="Open blockers, escalated EODs, and pending approvals"
          items={data.queues.items}
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 5. MANAGER DASHBOARD (STRICTLY SCOPED TO ASSIGNED DEPTS, PROJECTS & TEAMS)
 * ========================================================================== */
function ManagerDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  const deptNames = data.scope.managedDepartments.map((d) => d.name);
  const hasAnyScope =
    data.scope.scopedHeadcount > 0 ||
    data.scope.scopedProjectsCount > 0 ||
    deptNames.length > 0;

  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle={
          deptNames.length > 0
            ? `Managing ${deptNames.join(", ")} · ${data.scope.scopedProjectsCount} scoped project(s) and ${data.scope.scopedHeadcount} team member(s).`
            : `Scoped oversight across ${data.scope.scopedProjectsCount} assigned project(s) and ${data.scope.scopedHeadcount} subordinate team member(s).`
        }
      />

      <PersonalShiftQuickStrip data={data} />

      {data.recruitment.assignedUpcomingInterviewsCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">
              You have {data.recruitment.assignedUpcomingInterviewsCount} upcoming candidate interview(s) assigned
            </p>
            <p className="text-xs text-muted-foreground">
              Review candidate profiles/resumes and submit structured interview scorecards.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/interviews">Open Assigned Interviews</Link>
          </Button>
        </div>
      )}

      {!hasAnyScope && (
        <DashboardEmptyState
          icon={Building2}
          title="No departments, projects, or Leads assigned to your Manager scope yet"
          description="Your Manager workspace is strictly isolated to assigned departments, projects, and reporting trees. Ask HR, Admin, or Super Admin to link your account as a Department Manager or Project Manager."
        />
      )}

      <KpiGrid>
        <KpiCard
          label="Scoped Team Headcount"
          value={data.scope.scopedHeadcount}
          hint={
            deptNames.length > 0
              ? `Departments: ${deptNames.join(", ")}`
              : "Direct & 2-hop reporting tree"
          }
          icon={Users}
          tone="primary"
          href="/workforce"
        />
        <KpiCard
          label="Team Checked In Today"
          value={`${data.attendance.checkedInToday} / ${data.attendance.expectedActiveCount}`}
          hint={`${data.attendance.wfoToday} WFO · ${data.attendance.wfhToday} WFH · ${data.attendance.onLeaveToday} Leave`}
          icon={AlarmClock}
          tone="success"
          href="/team"
        />
        <KpiCard
          label="Assigned Projects"
          value={data.projects.activeCount}
          hint={`${data.projects.totalVisible} total in your scope`}
          icon={FolderKanban}
          tone="info"
          href="/projects"
        />
        <KpiCard
          label="Escalations & Pending Reviews"
          value={data.queues.totalPending}
          hint={`${data.queues.escalatedEodsCount} escalations · ${data.queues.openBlockersCount} blockers`}
          icon={AlertTriangle}
          tone={data.queues.totalPending > 0 ? "warning" : "default"}
          href="/reviews"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: "Scoped Projects",
            description: "Manage assigned project allocations",
            to: "/projects",
            icon: FolderKanban,
            tone: "primary",
          },
          {
            label: "Team EODs & Attendance",
            description: "Review EODs & escalations",
            to: "/team",
            icon: UsersRound,
            tone: "success",
          },
          {
            label: "Tasks & Blockers",
            description: `${data.queues.pendingTasksCount} tasks · ${data.queues.openBlockersCount} blockers`,
            to: "/reviews",
            icon: ListChecks,
            tone: "warning",
          },
          {
            label: "Scoped Reports",
            description: "Export team performance CSVs",
            to: "/reports",
            icon: BarChart3,
            tone: "info",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <AttendanceSummaryPanel
          title="Scoped team attendance & 14-day trend"
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
        <PendingActionQueue
          title="Team escalations, blockers & approvals"
          description="Items requiring Manager or Lead-tier intervention in your scope"
          items={data.queues.items}
        />
      </div>

      <ProjectPerformanceCard
        title="Assigned project performance"
        description="Headcount and 14-day output across projects in your Manager scope"
        projects={data.projects.portfolio}
        unallocatedActiveStaff={data.projects.unallocatedActiveStaff}
        overAllocatedStaff={data.projects.overAllocatedStaff}
      />

      <TeamProductivityCard
        title="Scoped Leads & team productivity"
        description="Live check-in status and 14-day delivery metrics across your assigned teams"
        members={data.teamProductivity}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeedCard
          title="Announcements & upcoming holidays"
          items={data.orgUpdatesFeed}
          emptyTitle="No published announcements or upcoming holidays"
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 6. LEAD DASHBOARD
 * ========================================================================== */
function LeadDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle={`Supervising ${data.scope.scopedHeadcount} direct report(s) and project team member(s) — review hourly tasks, resolve blockers, and sign off EODs.`}
      />

      <PersonalShiftQuickStrip data={data} />

      {data.recruitment.assignedUpcomingInterviewsCount > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-info/40 bg-info/5 px-4 py-3 text-sm">
          <div>
            <p className="font-medium text-foreground">
              You have {data.recruitment.assignedUpcomingInterviewsCount} upcoming candidate interview(s) assigned
            </p>
            <p className="text-xs text-muted-foreground">
              Review candidate profiles/resumes and submit structured interview scorecards.
            </p>
          </div>
          <Button asChild size="sm" variant="outline">
            <Link to="/interviews">Open Assigned Interviews</Link>
          </Button>
        </div>
      )}

      <KpiGrid>
        <KpiCard
          label="Team Checked In Today"
          value={`${data.attendance.checkedInToday} / ${data.attendance.expectedActiveCount}`}
          hint={`${data.attendance.uncheckedInToday} not checked in · ${data.attendance.onLeaveToday} on leave`}
          icon={UsersRound}
          tone="primary"
          href="/team"
        />
        <KpiCard
          label="Pending Task Reviews"
          value={data.queues.pendingTasksCount}
          hint="Submitted hourly task entries"
          icon={ListChecks}
          tone={data.queues.pendingTasksCount > 0 ? "warning" : "success"}
          href="/reviews"
        />
        <KpiCard
          label="Pending EOD Reviews"
          value={data.queues.pendingEodsCount}
          hint="Awaiting Lead sign-off"
          icon={ClipboardCheck}
          tone={data.queues.pendingEodsCount > 0 ? "info" : "default"}
          href="/team"
        />
        <KpiCard
          label="Blockers & Requests"
          value={data.queues.openBlockersCount + data.queues.pendingLeadRequestsCount}
          hint={`${data.queues.openBlockersCount} blockers · ${data.queues.pendingLeadRequestsCount} requests`}
          icon={AlertTriangle}
          tone={
            data.queues.openBlockersCount > 0
              ? "danger"
              : data.queues.pendingLeadRequestsCount > 0
                ? "warning"
                : "default"
          }
          href="/reviews"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: "Task & Blocker Reviews",
            description: "Approve units & resolve blockers",
            to: "/reviews",
            icon: ListChecks,
            tone: "primary",
          },
          {
            label: "Team EODs & Attendance",
            description: "Sign off daily EOD reports",
            to: "/team",
            icon: UsersRound,
            tone: "success",
          },
          {
            label: "Team Requests",
            description: `${data.queues.pendingLeadRequestsCount} awaiting Lead decision`,
            to: "/requests",
            icon: CalendarClock,
            tone: "info",
          },
          {
            label: "My Day",
            description: "Log your own attendance & tasks",
            to: "/my-day",
            icon: AlarmClock,
            tone: "default",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <PendingActionQueue
          title="Direct-report review queue"
          description="Tasks, EODs, blockers, and Stage-1 requests awaiting your action"
          items={data.queues.items}
          emptyMessage="Zero pending tasks, blockers, or EOD reviews from your team."
        />
        <AttendanceSummaryPanel
          title="Direct-report attendance & 14-day trend"
          expectedActiveCount={data.attendance.expectedActiveCount}
          checkedInToday={data.attendance.checkedInToday}
          wfoToday={data.attendance.wfoToday}
          wfhToday={data.attendance.wfhToday}
          hybridOrFieldToday={data.attendance.hybridOrFieldToday}
          onLeaveToday={data.attendance.onLeaveToday}
          uncheckedInToday={data.attendance.uncheckedInToday}
          avgAchievementPct14d={data.attendance.summary14d.avgAchievementPct}
          problemDays14d={data.attendance.summary14d.problemDays}
          trend14d={data.attendance.trend14d}
        />
      </div>

      <TeamProductivityCard
        title="Direct reports today & 14-day output"
        description="Live check-in mode and productivity metrics for your team"
        members={data.teamProductivity}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        <ActivityFeedCard
          title="Announcements & upcoming holidays"
          items={data.orgUpdatesFeed}
          emptyTitle="No published announcements or upcoming holidays"
        />
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
      </div>
    </div>
  );
}

/* ============================================================================
 * 7. EMPLOYEE DASHBOARD
 * ========================================================================== */
function EmployeeDashboard({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  const p = data.personal;
  const pendingOwnRequestsCount = p.recentRequests.filter(
    (r) => r.status === "pending",
  ).length;

  return (
    <div className="space-y-6">
      <DashboardRoleHeader
        data={data}
        subtitle="Track today's attendance, log hourly task output, manage breaks and blockers, submit your EOD report, and follow Lead feedback."
      />

      {/* Conditional onboarding banner when employee profile is not yet verified active */}
      {p.accountStatus !== "active" && (
        <Card className="border-warning/40 bg-warning/10">
          <CardContent className="flex flex-col items-start justify-between gap-4 py-4 sm:flex-row sm:items-center">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <Badge variant="outline" className="border-warning/40 bg-card text-warning">
                  {ACCOUNT_STATUS_LABELS[p.accountStatus]}
                </Badge>
                <span className="font-mono text-xs text-muted-foreground">
                  {p.uploadedRequiredDocsCount} / {p.totalRequiredDocsCount} required KYC documents
                  uploaded
                </span>
              </div>
              <p className="font-display text-sm font-semibold text-foreground">
                {p.accountStatus === "under_verification"
                  ? "Your onboarding profile is submitted and awaiting HR verification."
                  : "Complete your profile details and upload required KYC documents to finish onboarding."}
              </p>
            </div>
            <Button asChild size="sm">
              <Link to="/onboarding">
                {p.accountStatus === "under_verification"
                  ? "View onboarding status"
                  : "Complete onboarding"}
              </Link>
            </Button>
          </CardContent>
        </Card>
      )}

      <KpiGrid>
        <KpiCard
          label="Today's Shift & Hours"
          value={p.checkedIn ? formatHoursMinutes(p.workedMinutes) : "Not Checked In"}
          hint={
            p.checkedIn
              ? `${p.workMode?.toUpperCase() ?? "SHIFT"}${p.hasOpenBreak ? " · On Break" : ""}${p.checkedOut ? " · Checked Out" : ""}`
              : "Open My Day to start your shift"
          }
          icon={AlarmClock}
          tone={p.checkedIn ? "success" : "primary"}
          href="/my-day"
        />
        <KpiCard
          label="Today's Task Output"
          value={`${p.unitsCompleted} units`}
          hint={
            p.dailyAchievementPct != null
              ? `${p.dailyAchievementPct}% of daily target (${p.taskCounts.total} entries)`
              : `${p.taskCounts.total} task entries (${p.taskCounts.rework} rework)`
          }
          icon={CheckCircle2}
          tone={p.taskCounts.rework > 0 ? "warning" : "info"}
          href="/my-day"
        />
        <KpiCard
          label="Assigned Projects"
          value={p.activeAllocations.length}
          hint={
            p.unacknowledgedAllocsCount > 0
              ? `${p.unacknowledgedAllocsCount} new assignment(s) need acknowledgment`
              : "Active project allocations"
          }
          icon={Briefcase}
          tone={p.unacknowledgedAllocsCount > 0 ? "warning" : "primary"}
          href="/my-projects"
        />
        <KpiCard
          label="EOD & Requests"
          value={p.eodStatus ? p.eodStatus.replace(/_/g, " ").toUpperCase() : "EOD Pending"}
          hint={`${pendingOwnRequestsCount} active request(s) · ${p.openBlockersCount} open blocker(s)`}
          icon={CalendarClock}
          tone={
            p.eodStatus === "revision_required" || p.openBlockersCount > 0
              ? "danger"
              : p.eodStatus === "submitted" || p.eodStatus === "approved"
                ? "success"
                : "default"
          }
          href="/my-day"
        />
      </KpiGrid>

      <QuickActionsBar
        actions={[
          {
            label: p.checkedIn ? "Log Tasks & EOD" : "Check In for Today",
            description: "Attendance, breaks, blockers & EOD",
            to: "/my-day",
            icon: AlarmClock,
            tone: "primary",
          },
          {
            label: "My Assignments",
            description: "Project targets & acknowledgments",
            to: "/my-projects",
            icon: Briefcase,
            tone: "info",
          },
          {
            label: "Leave & WFH Requests",
            description: "Apply for leave, WFH, or correction",
            to: "/requests",
            icon: CalendarClock,
            tone: "success",
          },
          {
            label: "My Profile & KYC",
            description: "Personal details, documents & password",
            to: "/onboarding",
            icon: UserCircle2,
            tone: "default",
          },
        ]}
      />

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Assigned Projects & Targets */}
        <Card>
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between gap-2">
              <div>
                <CardTitle className="font-display text-base font-semibold">
                  Assigned projects & targets
                </CardTitle>
                <CardDescription>
                  Your active project allocations and daily output expectations
                </CardDescription>
              </div>
              <Button asChild variant="outline" size="sm">
                <Link to="/my-projects">All assignments</Link>
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {p.activeAllocations.length === 0 ? (
              <DashboardEmptyState
                icon={Briefcase}
                title="No project allocations yet"
                description="Once your Lead or Admin allocates you to a project, its targets and work mode will appear here."
                compact
              />
            ) : (
              <ul className="divide-y divide-border">
                {p.activeAllocations.map((a) => (
                  <li
                    key={a.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-2.5 first:pt-0 last:pb-0"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">
                        <span className="mr-1.5 font-mono text-xs text-muted-foreground">
                          {a.projectCode}
                        </span>
                        {a.projectName}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {a.roleInProject ?? "Contributor"} · {a.workMode.toUpperCase()}
                        {a.dailyTarget != null
                          ? ` · Target: ${a.dailyTarget} ${a.taskUnit}/day`
                          : ""}
                      </p>
                    </div>
                    {a.acknowledged ? (
                      <Badge variant="outline" className="font-mono text-xs">
                        {a.allocationPct}%
                      </Badge>
                    ) : (
                      <Button asChild size="sm" variant="default">
                        <Link to="/my-projects">Acknowledge</Link>
                      </Button>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        <ActivityFeedCard
          title="Recent Lead review feedback"
          description="Task and EOD sign-offs or revision notes from your Lead"
          items={p.feedbackFeed}
          emptyTitle="No review notes yet"
          emptyDescription="Feedback from your Lead on submitted tasks and EOD reports will appear here."
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <NotificationsSummaryCard
          unreadCount={data.notifications.unreadCount}
          items={data.notifications.items}
          markingNotificationId={markingNotificationId}
          onMarkRead={onMarkNotificationRead}
        />
        <ActivityFeedCard
          title="Announcements & upcoming holidays"
          items={data.orgUpdatesFeed}
          emptyTitle="No published announcements or upcoming holidays"
        />
      </div>
    </div>
  );
}

export function RoleDashboardView({
  data,
  markingNotificationId,
  onMarkNotificationRead,
}: {
  data: RoleDashboardData;
  markingNotificationId?: string | null | undefined;
  onMarkNotificationRead: (id: string) => void;
}) {
  switch (data.actor.primaryRole) {
    case "super_admin":
      return (
        <SuperAdminDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    case "founder":
      return (
        <FounderDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    case "hr":
      return (
        <HrDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    case "admin":
      return (
        <AdminDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    case "manager":
      return (
        <ManagerDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    case "lead":
      return (
        <LeadDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
    default:
      return (
        <EmployeeDashboard
          data={data}
          markingNotificationId={markingNotificationId}
          onMarkNotificationRead={onMarkNotificationRead}
        />
      );
  }
}
