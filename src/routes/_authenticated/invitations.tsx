import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import { CheckCircle2, History, UserPlus } from "lucide-react";
import { AppShell } from "@/components/app-shell";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { HubSubNav, ONBOARDING_HUB_TABS } from "@/components/hub-subnav";
import {
  ONBOARDED_EMPLOYEES_QUERY_KEY,
  OnboardedEmployeesPanel,
} from "@/components/onboarding/onboarded-employees-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { listInvitations } from "@/lib/invitations.functions";
import {
  ONBOARDING_CATEGORIES,
  ONBOARDING_CATEGORY_LABELS,
  ONBOARDING_WORK_TYPE_LABELS,
  type OnboardingRawRow,
  type ValidatedOnboardingRow,
} from "@/lib/onboarding/employee-onboarding";
import {
  createOnboardedEmployees,
  getOnboardingContext,
  validateOnboardingBatch,
  type CreateEmployeeResult,
} from "@/lib/onboarding.functions";
import { ROLE_LABELS } from "@/lib/permissions";
import { WORK_TYPES } from "@/lib/work-type";

export const Route = createFileRoute("/_authenticated/invitations")({
  head: () => ({
    meta: [
      { title: "Add Employee | The AI School HRM" },
      {
        name: "description",
        content: "Create employee accounts with automatic TAS IDs and send secure setup emails.",
      },
    ],
  }),
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: AddEmployeePage,
  errorComponent: ({ error }) => errorToAccessScreen(error),
});

type FormState = {
  first_name: string;
  last_name: string;
  work_email: string;
  date_of_birth: string;
  work_type: string;
  role: string;
  employment_category: string;
  designation: string;
  department: string;
  reporting_lead_email: string;
  joining_date: string;
};

const EMPTY_FORM: FormState = {
  first_name: "",
  last_name: "",
  work_email: "",
  date_of_birth: "",
  work_type: "",
  role: "",
  employment_category: "",
  designation: "",
  department: "",
  reporting_lead_email: "",
  joining_date: "",
};

const selectClass =
  "flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm disabled:opacity-50";

function AddEmployeePage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const queryClient = useQueryClient();
  const canCreate = actor.can("workforce:create:all");
  const canReadInvites = actor.can("invitations:read:all");

  const ctx = useQuery({
    queryKey: ["onboarding", "context"],
    queryFn: () => getOnboardingContext(),
    enabled: canCreate,
  });

  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [step, setStep] = useState<"form" | "review" | "done">("form");
  const [preview, setPreview] = useState<ValidatedOnboardingRow | null>(null);
  const [batchKey, setBatchKey] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<CreateEmployeeResult | null>(null);
  const [showHistory, setShowHistory] = useState(false);

  if (!canCreate) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Employee onboarding is available to HR, Admin and Super Admin only."
      />
    );
  }

  const set = (key: keyof FormState) => (value: string) => setForm((f) => ({ ...f, [key]: value }));

  function toRawRow(): OnboardingRawRow {
    return { rowNumber: 1, ...form };
  }

  async function review(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    try {
      const res = await validateOnboardingBatch({ data: { rows: [toRawRow()] } });
      setPreview((res.rows[0] as ValidatedOnboardingRow) ?? null);
      setBatchKey(crypto.randomUUID());
      setStep("review");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Validation failed.");
    } finally {
      setBusy(false);
    }
  }

  async function create() {
    setBusy(true);
    try {
      const res = await createOnboardedEmployees({
        data: { batchKey, source: "single", rows: [toRawRow()] },
      });
      const r = res.results[0] ?? null;
      setResult(r);
      if (r?.outcome === "created") {
        toast.success(`Employee created: ${r.employeeCode}. No email was sent.`);
        setStep("done");
        await queryClient.invalidateQueries({ queryKey: ONBOARDED_EMPLOYEES_QUERY_KEY });
        await queryClient.invalidateQueries({ queryKey: ["onboarding", "context"] });
      } else {
        toast.error(r?.reason ?? "Employee was not created.");
      }
    } catch (error) {
      // Safe to retry: the same batch key never creates a second account.
      toast.error(error instanceof Error ? error.message : "Could not create the employee.");
    } finally {
      setBusy(false);
    }
  }

  function startOver() {
    setForm(EMPTY_FORM);
    setPreview(null);
    setResult(null);
    setBatchKey("");
    setStep("form");
  }

  const roles = ctx.data?.assignableRoles ?? [];
  const creatable = preview && (preview.status === "valid" || preview.status === "warning");

  return (
    <AppShell
      title="Employee Onboarding"
      description="Add a single employee. Accounts are created first; the secure setup email is a separate, optional step."
    >
      <HubSubNav tabs={ONBOARDING_HUB_TABS} />

      <div className="grid gap-6 xl:grid-cols-[440px_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <UserPlus className="size-4" aria-hidden="true" /> Add Single Employee
            </CardTitle>
            <CardDescription>
              Next employee ID:{" "}
              <Badge variant="secondary" className="font-mono">
                {ctx.data?.nextEmployeeIdPreview ?? "…"}
              </Badge>{" "}
              (preview — assigned atomically on creation)
            </CardDescription>
          </CardHeader>
          <CardContent>
            {step === "form" ? (
              <form onSubmit={review} className="space-y-3">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="ob-first" label="First name" required>
                    <Input id="ob-first" required maxLength={60} value={form.first_name} onChange={(e) => set("first_name")(e.target.value)} />
                  </Field>
                  <Field id="ob-last" label="Last name" required>
                    <Input id="ob-last" required maxLength={60} value={form.last_name} onChange={(e) => set("last_name")(e.target.value)} />
                  </Field>
                </div>
                <Field id="ob-email" label="Work email" required>
                  <Input id="ob-email" type="email" required autoComplete="off" value={form.work_email} onChange={(e) => set("work_email")(e.target.value)} />
                </Field>
                <Field id="ob-dob" label="Date of birth" required hint="Confidential — visible only to the employee, HR and Super Admin.">
                  <Input id="ob-dob" type="date" required max={ctx.data?.todayIso} value={form.date_of_birth} onChange={(e) => set("date_of_birth")(e.target.value)} />
                </Field>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field id="ob-worktype" label="Work type" required>
                    <select id="ob-worktype" required className={selectClass} value={form.work_type} onChange={(e) => set("work_type")(e.target.value)}>
                      <option value="">Select…</option>
                      {WORK_TYPES.map((w) => (
                        <option key={w} value={w}>{ONBOARDING_WORK_TYPE_LABELS[w]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ob-role" label="Authorization role" required>
                    <select id="ob-role" required className={selectClass} value={form.role} onChange={(e) => set("role")(e.target.value)}>
                      <option value="">Select…</option>
                      {roles.map((r) => (
                        <option key={r} value={r}>{ROLE_LABELS[r]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ob-category" label="Employment category" required>
                    <select id="ob-category" required className={selectClass} value={form.employment_category} onChange={(e) => set("employment_category")(e.target.value)}>
                      <option value="">Select…</option>
                      {ONBOARDING_CATEGORIES.map((c) => (
                        <option key={c} value={c}>{ONBOARDING_CATEGORY_LABELS[c]}</option>
                      ))}
                    </select>
                  </Field>
                  <Field id="ob-designation" label="Designation" required>
                    <Input id="ob-designation" required maxLength={80} value={form.designation} onChange={(e) => set("designation")(e.target.value)} />
                  </Field>
                </div>

                <details className="rounded-md border border-border p-3 text-sm">
                  <summary className="cursor-pointer text-xs font-medium text-muted-foreground">
                    Optional details (department, reporting lead, joining date)
                  </summary>
                  <div className="mt-3 space-y-3">
                    <Field id="ob-dept" label="Department">
                      <select id="ob-dept" className={selectClass} value={form.department} onChange={(e) => set("department")(e.target.value)}>
                        <option value="">Unassigned</option>
                        {(ctx.data?.departments ?? []).map((d) => (
                          <option key={d.id} value={d.name}>{d.name}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id="ob-lead" label="Reporting lead">
                      <select id="ob-lead" className={selectClass} value={form.reporting_lead_email} onChange={(e) => set("reporting_lead_email")(e.target.value)}>
                        <option value="">Assign later</option>
                        {(ctx.data?.leads ?? []).map((l) => (
                          <option key={l.id} value={l.workEmail}>{l.fullName}</option>
                        ))}
                      </select>
                    </Field>
                    <Field id="ob-join" label="Joining date">
                      <Input id="ob-join" type="date" value={form.joining_date} onChange={(e) => set("joining_date")(e.target.value)} />
                    </Field>
                  </div>
                </details>

                <Button type="submit" className="w-full" disabled={busy || ctx.isLoading}>
                  {busy ? "Checking…" : "Review"}
                </Button>
              </form>
            ) : step === "review" && preview ? (
              <div className="space-y-3 text-sm">
                <dl className="grid grid-cols-[140px_1fr] gap-x-3 gap-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <dt className="text-muted-foreground">Name</dt><dd className="font-medium">{preview.fullName}</dd>
                  <dt className="text-muted-foreground">Work email</dt><dd>{preview.workEmail}</dd>
                  <dt className="text-muted-foreground">Date of birth</dt><dd>{preview.dobStatus === "valid" ? "Valid (hidden)" : "Invalid"}</dd>
                  <dt className="text-muted-foreground">Work type</dt><dd>{preview.workType ? ONBOARDING_WORK_TYPE_LABELS[preview.workType] : "—"}</dd>
                  <dt className="text-muted-foreground">Role</dt><dd>{preview.role ? ROLE_LABELS[preview.role] : "—"}</dd>
                  <dt className="text-muted-foreground">Category</dt><dd>{preview.category ? ONBOARDING_CATEGORY_LABELS[preview.category] : "—"}</dd>
                  <dt className="text-muted-foreground">Designation</dt><dd>{preview.designation}</dd>
                  <dt className="text-muted-foreground">Department</dt><dd>{preview.departmentName ?? "Unassigned"}</dd>
                </dl>
                {preview.errors.length > 0 ? (
                  <ul role="alert" className="list-disc space-y-0.5 rounded-md border border-destructive/40 bg-destructive/10 p-3 pl-6 text-xs text-destructive">
                    {preview.errors.map((e) => <li key={e}>{e}</li>)}
                  </ul>
                ) : null}
                {preview.warnings.length > 0 ? (
                  <ul className="list-disc space-y-0.5 rounded-md border border-warning/40 bg-warning/10 p-3 pl-6 text-xs">
                    {preview.warnings.map((w) => <li key={w}>{w}</li>)}
                  </ul>
                ) : null}
                <div className="flex gap-2">
                  <Button type="button" variant="outline" className="flex-1" disabled={busy} onClick={() => setStep("form")}>
                    Edit
                  </Button>
                  <Button type="button" className="flex-1" disabled={busy || !creatable} onClick={() => void create()}>
                    {busy ? "Creating…" : "Create Employee"}
                  </Button>
                </div>
                <p className="text-[11px] text-muted-foreground">Creating the account does not send any email.</p>
              </div>
            ) : step === "done" && result ? (
              <div className="space-y-3 text-sm">
                <div className="flex items-start gap-2 rounded-md border border-emerald-500/40 bg-emerald-500/10 p-3">
                  <CheckCircle2 className="mt-0.5 size-4 text-emerald-600" aria-hidden="true" />
                  <div>
                    <p className="font-medium">{result.fullName} created</p>
                    <p className="text-xs text-muted-foreground">
                      Employee ID <span className="font-mono font-semibold text-foreground">{result.employeeCode}</span> ·{" "}
                      {result.workEmail}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Use “Send account setup email” in the list to invite them securely.
                    </p>
                  </div>
                </div>
                <Button type="button" variant="outline" className="w-full" onClick={startOver}>
                  Add another employee
                </Button>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <div className="space-y-6">
          <OnboardedEmployeesPanel />

          {canReadInvites ? (
            <Card>
              <CardHeader className="flex flex-row items-center justify-between space-y-0">
                <div>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <History className="size-4" aria-hidden="true" /> Legacy invitation history
                  </CardTitle>
                  <CardDescription>Read-only audit record of earlier invitation-based onboarding.</CardDescription>
                </div>
                <Button type="button" size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
                  {showHistory ? "Hide" : "Show"}
                </Button>
              </CardHeader>
              {showHistory ? (
                <CardContent>
                  <LegacyInvitationHistory />
                </CardContent>
              ) : null}
            </Card>
          ) : null}
        </div>
      </div>
    </AppShell>
  );
}

function Field(props: {
  id: string;
  label: string;
  required?: boolean;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-1.5">
      <Label htmlFor={props.id} className="text-xs text-muted-foreground">
        {props.label} {props.required ? <span className="text-primary">*</span> : null}
      </Label>
      {props.children}
      {props.hint ? <p className="text-[11px] text-muted-foreground">{props.hint}</p> : null}
    </div>
  );
}

function LegacyInvitationHistory() {
  const { data, isLoading } = useQuery({
    queryKey: ["invitations"],
    queryFn: () => listInvitations(),
  });
  if (isLoading) return <p className="text-sm text-muted-foreground">Loading…</p>;
  const rows = data ?? [];
  if (rows.length === 0) return <p className="text-sm text-muted-foreground">No legacy invitations.</p>;
  return (
    <div className="overflow-x-auto rounded-md border border-border">
      <table className="w-full min-w-[520px] text-sm">
        <thead className="border-b border-border bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <th scope="col" className="px-3 py-2 font-medium">Invitee</th>
            <th scope="col" className="px-3 py-2 font-medium">Role</th>
            <th scope="col" className="px-3 py-2 font-medium">Status</th>
            <th scope="col" className="px-3 py-2 font-medium">Source</th>
            <th scope="col" className="px-3 py-2 font-medium">Created</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="px-3 py-2">
                <p className="font-medium">{r.full_name ?? r.email}</p>
                <p className="text-xs text-muted-foreground">{r.email}</p>
              </td>
              <td className="px-3 py-2 text-xs">{ROLE_LABELS[r.role] ?? r.role}</td>
              <td className="px-3 py-2"><Badge variant="neutral">{r.status}</Badge></td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{r.source}</td>
              <td className="px-3 py-2 text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-IN", { timeZone: "Asia/Kolkata" })}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
