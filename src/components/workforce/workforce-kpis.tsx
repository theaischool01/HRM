import { AlertTriangle, CheckCircle2, Clock, FileCheck2, FileText, Inbox, Users } from "lucide-react";

export type WorkforceKpiStats = {
  totalActive: number;
  onboardingPending: number;
  profilesAwaitingReview: number;
  kycVerificationPending: number;
  kycCorrectionsRequired: number;
  openRequests: number;
};

export type ActiveFilterShortcut =
  | "active_only"
  | "onboarding_pending"
  | "profiles_awaiting_review"
  | "kyc_pending"
  | "kyc_corrections"
  | "open_requests"
  | null;

export type WorkforceKpisProps = {
  stats: WorkforceKpiStats;
  activeShortcut: ActiveFilterShortcut;
  onSelectShortcut: (shortcut: ActiveFilterShortcut) => void;
};

export function WorkforceKpis({ stats, activeShortcut, onSelectShortcut }: WorkforceKpisProps) {
  const cards = [
    {
      id: "active_only" as const,
      label: "Total Active Employees",
      value: stats.totalActive,
      sublabel: "Staff on active duty",
      icon: Users,
      color: "text-emerald-600 dark:text-emerald-400",
      bg: "bg-emerald-50 dark:bg-emerald-950/40",
      border: "hover:border-emerald-300 dark:hover:border-emerald-800",
      activeRing: "ring-2 ring-emerald-500 border-emerald-400 bg-emerald-50/70 dark:bg-emerald-950/60",
    },
    {
      id: "onboarding_pending" as const,
      label: "Onboarding Pending",
      value: stats.onboardingPending,
      sublabel: "Setup or profile incomplete",
      icon: Clock,
      color: "text-amber-600 dark:text-amber-400",
      bg: "bg-amber-50 dark:bg-amber-950/40",
      border: "hover:border-amber-300 dark:hover:border-amber-800",
      activeRing: "ring-2 ring-amber-500 border-amber-400 bg-amber-50/70 dark:bg-amber-950/60",
    },
    {
      id: "profiles_awaiting_review" as const,
      label: "Profiles Awaiting HR Review",
      value: stats.profilesAwaitingReview,
      sublabel: "Submitted for verification",
      icon: FileCheck2,
      color: "text-blue-600 dark:text-blue-400",
      bg: "bg-blue-50 dark:bg-blue-950/40",
      border: "hover:border-blue-300 dark:hover:border-blue-800",
      activeRing: "ring-2 ring-blue-500 border-blue-400 bg-blue-50/70 dark:bg-blue-950/60",
    },
    {
      id: "kyc_pending" as const,
      label: "KYC Verification Pending",
      value: stats.kycVerificationPending,
      sublabel: "Uploaded documents in queue",
      icon: FileText,
      color: "text-indigo-600 dark:text-indigo-400",
      bg: "bg-indigo-50 dark:bg-indigo-950/40",
      border: "hover:border-indigo-300 dark:hover:border-indigo-800",
      activeRing: "ring-2 ring-indigo-500 border-indigo-400 bg-indigo-50/70 dark:bg-indigo-950/60",
    },
    {
      id: "kyc_corrections" as const,
      label: "KYC Corrections Required",
      value: stats.kycCorrectionsRequired,
      sublabel: "Rejected documents pending fix",
      icon: AlertTriangle,
      color: "text-red-600 dark:text-red-400",
      bg: "bg-red-50 dark:bg-red-950/40",
      border: "hover:border-red-300 dark:hover:border-red-800",
      activeRing: "ring-2 ring-red-500 border-red-400 bg-red-50/70 dark:bg-red-950/60",
    },
    {
      id: "open_requests" as const,
      label: "Open Employee Requests",
      value: stats.openRequests,
      sublabel: "Leave, WFH, corrections",
      icon: Inbox,
      color: "text-purple-600 dark:text-purple-400",
      bg: "bg-purple-50 dark:bg-purple-950/40",
      border: "hover:border-purple-300 dark:hover:border-purple-800",
      activeRing: "ring-2 ring-purple-500 border-purple-400 bg-purple-50/70 dark:bg-purple-950/60",
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
      {cards.map((c) => {
        const Icon = c.icon;
        const isActive = activeShortcut === c.id;
        return (
          <button
            key={c.id}
            type="button"
            onClick={() => onSelectShortcut(isActive ? null : c.id)}
            className={`group relative flex flex-col justify-between rounded-xl border border-border/80 bg-card p-3.5 text-left transition-all hover:shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ${
              c.border
            } ${isActive ? c.activeRing : ""}`}
            title={`Click to filter table by ${c.label}`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-muted-foreground line-clamp-1">{c.label}</span>
              <div className={`flex size-6 shrink-0 items-center justify-center rounded-md ${c.bg}`}>
                <Icon className={`size-3.5 ${c.color}`} aria-hidden="true" />
              </div>
            </div>
            <div className="mt-2.5">
              <div className="text-2xl font-bold tracking-tight text-foreground">{c.value}</div>
              <div className="mt-0.5 text-[11px] text-muted-foreground line-clamp-1">{c.sublabel}</div>
            </div>
            {isActive && (
              <div className="absolute right-2 top-2">
                <CheckCircle2 className="size-3.5 text-primary" aria-hidden="true" />
              </div>
            )}
          </button>
        );
      })}
    </div>
  );
}
