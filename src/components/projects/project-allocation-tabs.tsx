import { useState } from "react";
import { UserPlus, Users, Sparkles, X } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { SingleAllocationForm } from "./single-allocation-form";
import { BulkAllocationPanel } from "./bulk-allocation-panel";
import type { AllocatableEmployee } from "@/lib/allocations.functions";

interface ProjectAllocationTabsProps {
  projectId: string;
  projectName: string;
  projectWorkType?: string | null;
  employees: AllocatableEmployee[];
  availableLeads: Array<{ id: string; fullName: string; designation: string | null }>;
  departments?: Array<{ id: string; name: string }>;
  onClose: () => void;
  onRefresh: () => Promise<void>;
}

export function ProjectAllocationTabs({
  projectId,
  projectName,
  projectWorkType,
  employees,
  availableLeads,
  departments,
  onClose,
  onRefresh,
}: ProjectAllocationTabsProps) {
  const [activeTab, setActiveTab] = useState<"single" | "bulk">("single");

  return (
    <Card className="border-border/80 shadow-sm transition-all animate-in fade-in-50 duration-200">
      <CardHeader className="pb-3">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-semibold">Team Allocation</CardTitle>
              <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">
                Cross-Department Enabled
              </span>
            </div>
            <CardDescription className="text-xs">
              Allocate employees from ANY department or work type to <span className="font-medium text-foreground">{projectName}</span>.
              Assignments require employee acknowledgment.
            </CardDescription>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto">
            {/* Segmented Tab Controls */}
            <div className="inline-flex rounded-lg border border-border/80 bg-muted/40 p-1">
              <button
                type="button"
                onClick={() => setActiveTab("single")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  activeTab === "single"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <UserPlus className="size-3.5" />
                Add One Person
              </button>
              <button
                type="button"
                onClick={() => setActiveTab("bulk")}
                className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold transition-all ${
                  activeTab === "bulk"
                    ? "bg-background text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                <Users className="size-3.5" />
                Bulk Allocate
              </button>
            </div>

            <Button
              size="sm"
              variant="ghost"
              onClick={onClose}
              className="size-7 p-0 text-muted-foreground hover:text-foreground"
              title="Close allocation panel"
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
      </CardHeader>

      <CardContent>
        {activeTab === "single" ? (
          <SingleAllocationForm
            projectId={projectId}
            projectName={projectName}
            projectWorkType={projectWorkType ?? null}
            employees={employees}
            availableLeads={availableLeads}
            departments={departments ?? []}
            onSuccess={onRefresh}
          />
        ) : (
          <BulkAllocationPanel
            projectId={projectId}
            projectName={projectName}
            projectWorkType={projectWorkType ?? null}
            employees={employees}
            availableLeads={availableLeads}
            departments={departments ?? []}
            onSuccess={onRefresh}
          />
        )}
      </CardContent>
    </Card>
  );
}
