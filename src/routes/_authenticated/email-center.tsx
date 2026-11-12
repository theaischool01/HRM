import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient, useSuspenseQuery } from "@tanstack/react-query";
import {
  AlertTriangle,
  AlignLeft,
  CheckCircle2,
  Eye,
  FileCode2,
  Mail,
  Monitor,
  RefreshCw,
  RotateCcw,
  Save,
  Search,
  Send,
  ShieldAlert,
  Smartphone,
  Sparkles,
  Users,
  XCircle,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { AccessDenied, errorToAccessScreen } from "@/components/access-denied";
import { AppShell } from "@/components/app-shell";
import { HubSubNav, RECRUITMENT_HUB_TABS } from "@/components/hub-subnav";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { actorQueryOptions, useActor } from "@/hooks/use-actor";
import { describeUnknownError } from "@/lib/describe-error";
import {
  getEmailCenterData,
  resetEmailTemplateToDefault,
  retryFailedEmail,
  saveEmailDraft,
  saveEmailTemplate,
  sendBulkRecruitmentEmails,
  sendRecruitmentEmail,
} from "@/lib/email-center.functions";
import {
  EMAIL_VARIABLE_DESCRIPTIONS,
  renderEmailTemplate,
  SAMPLE_EMAIL_VARIABLES,
  SUPPORTED_EMAIL_VARIABLES,
  validateTemplateVariables,
  type EmailVariableKey,
} from "@/lib/recruitment/email-templates";

export const Route = createFileRoute("/_authenticated/email-center")({
  loader: ({ context }) => context.queryClient.ensureQueryData(actorQueryOptions),
  component: EmailCenterPage,
});

type ComposeMode = "individual" | "bulk" | "test";
type LogFilter = "all" | "sent" | "delivered" | "failed" | "draft";
type PreviewMode = "desktop" | "mobile" | "text";

function statusBadgeVariant(
  status: string,
): "success" | "info" | "destructive" | "neutral" | "outline" {
  if (status === "delivered") return "success";
  if (status === "sent") return "info";
  if (status === "failed") return "destructive";
  if (status === "draft") return "neutral";
  return "outline";
}

function statusDisplayLabel(status: string): string {
  switch (status) {
    case "sent":
      return "Sent (Provider Accepted)";
    case "delivered":
      return "Delivered (Confirmed)";
    case "failed":
      return "Failed";
    case "draft":
      return "Draft";
    default:
      return status;
  }
}

function EmailCenterPage() {
  useSuspenseQuery(actorQueryOptions);
  const actor = useActor();
  const queryClient = useQueryClient();

  const allowed = actor.can("emails:read:all");

  const centerQuery = useQuery({
    queryKey: ["recruitment", "email-center"],
    queryFn: () => getEmailCenterData(),
    enabled: allowed,
  });

  // Template editor state
  const [selectedSlug, setSelectedSlug] = useState<string>("application_received");
  const [tplName, setTplName] = useState("");
  const [tplCategory, setTplCategory] = useState("screening");
  const [tplSubject, setTplSubject] = useState("");
  const [tplBodyHtml, setTplBodyHtml] = useState("");
  const [tplBodyText, setTplBodyText] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);

  // Compose & Bulk state
  const [composeMode, setComposeMode] = useState<ComposeMode>("individual");
  const [composeSlug, setComposeSlug] = useState<string>("interview_invitation");
  const [composeCandidateId, setComposeCandidateId] = useState<string>("");
  const [composeRecipientEmail, setComposeRecipientEmail] = useState<string>("");
  const [composeRecipientName, setComposeRecipientName] = useState<string>("");
  const [composeSubjectTpl, setComposeSubjectTpl] = useState<string>("");
  const [composeBodyHtmlTpl, setComposeBodyHtmlTpl] = useState<string>("");
  const [composeBodyTextTpl, setComposeBodyTextTpl] = useState<string>("");
  const [composeVars, setComposeVars] = useState<Record<EmailVariableKey, string>>(() => ({
    ...SAMPLE_EMAIL_VARIABLES,
  }));
  const [bulkCandidateIds, setBulkCandidateIds] = useState<string[]>([]);
  const [bulkSearch, setBulkSearch] = useState<string>("");
  const [dispatchBusy, setDispatchBusy] = useState(false);
  const [previewMode, setPreviewMode] = useState<PreviewMode>("desktop");
  const [resetConfirmOpen, setResetConfirmOpen] = useState(false);
  const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);

  // Delivery history filter state
  const [logFilter, setLogFilter] = useState<LogFilter>("all");
  const [retryingId, setRetryingId] = useState<string | null>(null);

  const data = centerQuery.data;
  const templates = data?.templates ?? [];

  const activeTemplate = useMemo(
    () => templates.find((t) => t.slug === selectedSlug) ?? templates[0] ?? null,
    [templates, selectedSlug],
  );

  // Sync editor inputs when active template changes
  useEffect(() => {
    if (!activeTemplate) return;
    setTplName(activeTemplate.name);
    setTplCategory(activeTemplate.category);
    setTplSubject(activeTemplate.subjectTemplate);
    setTplBodyHtml(activeTemplate.bodyHtmlTemplate);
    setTplBodyText(activeTemplate.bodyTextTemplate ?? "");
  }, [activeTemplate]);

  // Sync compose template when composeSlug or templates load
  useEffect(() => {
    const found = templates.find((t) => t.slug === composeSlug);
    if (!found) return;
    setComposeSubjectTpl(found.subjectTemplate);
    setComposeBodyHtmlTpl(found.bodyHtmlTemplate);
    setComposeBodyTextTpl(found.bodyTextTemplate ?? "");
  }, [composeSlug, templates]);

  // Sync HR contact default when data loads
  useEffect(() => {
    if (!data?.actorContact) return;
    setComposeVars((prev) => ({
      ...prev,
      hr_contact: data.actorContact,
    }));
  }, [data?.actorContact]);

  if (!allowed) {
    return (
      <AccessDenied
        kind="forbidden"
        detail="Required permission: emails:read:all"
      />
    );
  }

  if (centerQuery.isError) {
    return errorToAccessScreen(centerQuery.error);
  }

  const canManageTemplates = Boolean(data?.canManageTemplates);
  const canSendEmails = Boolean(data?.canSendEmails);
  const providerConfigured = Boolean(data?.providerStatus.configured);

  const editorValidation = validateTemplateVariables({
    subjectTemplate: tplSubject,
    bodyHtmlTemplate: tplBodyHtml,
    bodyTextTemplate: tplBodyText || null,
  });

  const editorPreview = renderEmailTemplate({
    subjectTemplate: tplSubject || "(Subject)",
    bodyHtmlTemplate: tplBodyHtml || "<p>(Body)</p>",
    bodyTextTemplate: tplBodyText || null,
    variables: {
      ...SAMPLE_EMAIL_VARIABLES,
      hr_contact: data?.actorContact ?? SAMPLE_EMAIL_VARIABLES.hr_contact,
    },
  });

  const composePreview = renderEmailTemplate({
    subjectTemplate: composeSubjectTpl || "(Subject)",
    bodyHtmlTemplate: composeBodyHtmlTpl || "<p>(Body)</p>",
    bodyTextTemplate: composeBodyTextTpl || null,
    variables: composeVars,
  });

  const filteredMessages = (data?.messages ?? []).filter((m) =>
    logFilter === "all" ? true : m.status === logFilter,
  );

  async function refreshCenter() {
    await queryClient.invalidateQueries({ queryKey: ["recruitment", "email-center"] });
  }

  function insertVariableIntoHtml(varKey: EmailVariableKey) {
    if (!canManageTemplates) return;
    setTplBodyHtml((prev) => `${prev}{{${varKey}}}`);
  }

  function handleSelectComposeCandidate(candidateId: string) {
    setComposeCandidateId(candidateId);
    const cand = data?.candidates.find((c) => c.id === candidateId);
    if (!cand) return;
    setComposeRecipientEmail(cand.email);
    setComposeRecipientName(cand.fullName);
    setComposeVars((prev) => ({
      ...prev,
      candidate_name: cand.fullName,
      designation: cand.designation ?? "Team Member",
      department: cand.departmentName ?? "General",
      joining_date: cand.joiningDate ?? prev.joining_date,
    }));
  }

  function toggleBulkCandidate(id: string) {
    setBulkCandidateIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }

  async function handleSaveTemplate() {
    if (!activeTemplate) return;
    try {
      setSavingTemplate(true);
      await saveEmailTemplate({
        data: {
          slug: activeTemplate.slug,
          name: tplName,
          category: tplCategory,
          subjectTemplate: tplSubject,
          bodyHtmlTemplate: tplBodyHtml,
          bodyTextTemplate: tplBodyText || null,
        },
      });
      toast.success(`Saved template "${tplName}".`);
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleResetTemplate() {
    if (!activeTemplate) return;
    try {
      setSavingTemplate(true);
      await resetEmailTemplateToDefault({
        data: { slug: activeTemplate.slug },
      });
      toast.success(`Reset "${activeTemplate.name}" to standard default.`);
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
    } finally {
      setSavingTemplate(false);
    }
  }

  async function handleSaveDraft() {
    try {
      setDispatchBusy(true);
      await saveEmailDraft({
        data: {
          templateSlug: composeSlug,
          candidateId: composeCandidateId || null,
          recipientEmail: composeRecipientEmail,
          recipientName: composeRecipientName || null,
          subject: composePreview.subject,
          bodyHtml: composePreview.bodyHtml,
          bodyText: composePreview.bodyText,
          variables: composeVars,
        },
      });
      toast.success("Email draft saved to Delivery & Audit History.");
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
    } finally {
      setDispatchBusy(false);
    }
  }

  async function handleSendIndividualOrTest(isTest: boolean) {
    try {
      setDispatchBusy(true);
      const res = await sendRecruitmentEmail({
        data: {
          templateSlug: composeSlug,
          candidateId: isTest ? null : composeCandidateId || null,
          recipientEmail: composeRecipientEmail,
          recipientName: composeRecipientName || null,
          subjectTemplate: composeSubjectTpl,
          bodyHtmlTemplate: composeBodyHtmlTpl,
          bodyTextTemplate: composeBodyTextTpl || null,
          variables: composeVars,
          isTest,
        },
      });
      toast.success(
        res.deduplicated
          ? "Duplicate send prevented (already accepted within this window)."
          : `${isTest ? "Test email" : "Email"} accepted by provider (status: ${res.status}).`,
      );
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
      await refreshCenter();
    } finally {
      setDispatchBusy(false);
    }
  }

  async function handleSendBulk() {
    try {
      setDispatchBusy(true);
      const res = await sendBulkRecruitmentEmails({
        data: {
          candidateIds: bulkCandidateIds,
          templateSlug: composeSlug,
          sharedVariables: composeVars,
        },
      });
      toast.success(
        `Bulk dispatch complete: ${res.sentCount} sent, ${res.skippedDuplicateCount} skipped (duplicate), ${res.failedCount} failed.`,
      );
      setBulkCandidateIds([]);
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
    } finally {
      setDispatchBusy(false);
    }
  }

  async function handleRetryMessage(messageId: string) {
    try {
      setRetryingId(messageId);
      const res = await retryFailedEmail({ data: { messageId } });
      toast.success(`Retry succeeded — status updated to "${res.status}".`);
      await refreshCenter();
    } catch (err) {
      toast.error(describeUnknownError(err));
      await refreshCenter();
    } finally {
      setRetryingId(null);
    }
  }

  return (
    <AppShell
      title="HR Email & Communication Center"
      description="Manage all 12 standardized recruitment & onboarding templates, validate dynamic placeholders, preview branded layouts, and audit honest delivery states."
      actions={
        <Button
          size="sm"
          variant="outline"
          onClick={() => centerQuery.refetch()}
          disabled={centerQuery.isFetching}
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Refresh
        </Button>
      }
    >
      <HubSubNav tabs={RECRUITMENT_HUB_TABS} />

      {/* Schema Readiness Notice */}
      {data && !data.schemaReady ? (
        <Card className="mb-4 border-amber-500/40 bg-amber-500/5">
          <CardContent className="flex items-start gap-3 pt-5">
            <AlertTriangle className="mt-0.5 size-5 shrink-0 text-amber-600" />
            <div className="space-y-1 text-sm">
              <p className="font-semibold text-foreground">
                Phase P2 Email Tables Pending Migration Approval
              </p>
              <p className="text-muted-foreground">
                All 12 default HR templates are loaded for live variable validation and
                preview. Persistent template edits, drafts, and audit logs will activate
                once{" "}
                <code className="text-xs">
                  20261112000000_p2_recruitment_interviews_and_email_center.sql
                </code>{" "}
                is deployed.
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* Email Provider Readiness Gate */}
      {data ? (
        providerConfigured ? (
          <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-emerald-500/30 bg-emerald-500/5 px-4 py-3 text-xs">
            <div className="flex items-center gap-2">
              <CheckCircle2 className="size-4 text-emerald-600" />
              <span>
                <strong className="text-foreground">Verified Email Provider Active</strong>{" "}
                — Dispatches via Resend from{" "}
                <code className="font-mono">{data.providerStatus.senderDisplay}</code>.
              </span>
            </div>
            <Badge variant="secondary">Provider Ready</Badge>
          </div>
        ) : (
          <Card className="mb-5 border-amber-500/40 bg-amber-500/5">
            <CardContent className="flex items-start gap-3 pt-5">
              <ShieldAlert className="mt-0.5 size-5 shrink-0 text-amber-600" />
              <div className="space-y-1.5 text-xs">
                <p className="text-sm font-semibold text-foreground">
                  Live Email Sending Locked — Verified Sender Configuration Required
                </p>
                <p className="text-muted-foreground">
                  Template editing, variable validation, branded HTML preview, and saving
                  drafts are fully available. Live sending unlocks automatically once a
                  verified Resend domain is configured on the server:
                </p>
                <ul className="list-disc space-y-0.5 pl-4 text-muted-foreground">
                  {data.providerStatus.issues.map((issue) => (
                    <li key={issue}>{issue}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>
        )
      ) : null}

      {!canManageTemplates && !canSendEmails ? (
        <div className="mb-5 flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/30 px-4 py-2.5 text-xs text-muted-foreground">
          <span>
            <strong className="text-foreground">Read-Only Email Center View</strong> —
            Inspect standardized HR templates, variable previews, and communication audit
            logs.
          </span>
          <Badge variant="outline">Read-Only</Badge>
        </div>
      ) : null}

      <Tabs defaultValue="templates" className="space-y-5">
        <TabsList>
          <TabsTrigger value="templates">
            <FileCode2 className="mr-1.5 size-3.5" />
            12 HR Templates ({templates.length})
          </TabsTrigger>
          <TabsTrigger value="compose">
            <Send className="mr-1.5 size-3.5" />
            Compose, Bulk &amp; Test Send
          </TabsTrigger>
          <TabsTrigger value="logs">
            <Mail className="mr-1.5 size-3.5" />
            Delivery Status &amp; Retry ({data?.stats.total ?? 0})
          </TabsTrigger>
        </TabsList>

        {/* TAB 1: 12 EDITABLE TEMPLATES */}
        <TabsContent value="templates" className="space-y-4">
          <div className="grid gap-5 lg:grid-cols-12">
            {/* Left Template Selector */}
            <Card className="lg:col-span-4">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">Standard HR Templates</CardTitle>
                <CardDescription>
                  Select any lifecycle template to inspect or customize.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-1.5">
                {templates.map((tpl) => {
                  const selected = tpl.slug === activeTemplate?.slug;
                  return (
                    <button
                      key={tpl.slug}
                      type="button"
                      onClick={() => setSelectedSlug(tpl.slug)}
                      className={`flex w-full items-center justify-between rounded-md border px-3 py-2 text-left text-xs transition-colors ${
                        selected
                          ? "border-primary bg-primary/5 font-semibold text-foreground"
                          : "border-border/60 bg-card text-muted-foreground hover:bg-muted/40 hover:text-foreground"
                      }`}
                    >
                      <span className="truncate pr-2">{tpl.name}</span>
                      <Badge variant="outline" className="shrink-0 text-[10px] capitalize">
                        {tpl.category}
                      </Badge>
                    </button>
                  );
                })}
              </CardContent>
            </Card>

            {/* Right Editor + Live Branded Preview */}
            <div className="space-y-4 lg:col-span-8">
              <Card>
                <CardHeader className="pb-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <CardTitle className="text-base">
                        {activeTemplate?.name ?? "Template Editor"}
                      </CardTitle>
                      <CardDescription>
                        Slug: <code className="font-mono">{activeTemplate?.slug}</code>
                      </CardDescription>
                    </div>
                    {canManageTemplates ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setResetConfirmOpen(true)}
                          disabled={savingTemplate || !data?.schemaReady}
                        >
                          <RotateCcw className="mr-1.5 size-3.5" />
                          Reset Default
                        </Button>
                        <Button
                          size="sm"
                          onClick={handleSaveTemplate}
                          disabled={
                            savingTemplate ||
                            !editorValidation.valid ||
                            !data?.schemaReady
                          }
                        >
                          <Save className="mr-1.5 size-3.5" />
                          {savingTemplate ? "Saving..." : "Save Template"}
                        </Button>
                      </div>
                    ) : null}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {/* Supported Dynamic Variables Bar */}
                  <div className="rounded-lg border border-border bg-muted/30 p-3">
                    <p className="mb-2 flex items-center gap-1.5 text-xs font-medium text-foreground">
                      <Sparkles className="size-3.5 text-primary" />
                      Supported Dynamic Variables{" "}
                      {canManageTemplates ? "(click to append to HTML body)" : ""}
                    </p>
                    <div className="flex flex-wrap gap-1.5">
                      {SUPPORTED_EMAIL_VARIABLES.map((v) => (
                        <button
                          key={v}
                          type="button"
                          title={EMAIL_VARIABLE_DESCRIPTIONS[v]}
                          disabled={!canManageTemplates}
                          onClick={() => insertVariableIntoHtml(v)}
                          className="rounded border border-border bg-background px-2 py-0.5 font-mono text-[11px] text-foreground hover:border-primary disabled:cursor-default"
                        >
                          {`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>

                  {!editorValidation.valid ? (
                    <div className="rounded-md border border-rose-500/40 bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">
                      Unsupported placeholder(s):{" "}
                      <strong>
                        {editorValidation.unknownVariables
                          .map((v) => `{{${v}}}`)
                          .join(", ")}
                      </strong>
                      . Use only the supported variables listed above.
                    </div>
                  ) : null}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="tpl-name">Template Display Name</Label>
                      <Input
                        id="tpl-name"
                        value={tplName}
                        disabled={!canManageTemplates}
                        onChange={(e) => setTplName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="tpl-subject">Subject Line Template</Label>
                      <Input
                        id="tpl-subject"
                        value={tplSubject}
                        disabled={!canManageTemplates}
                        onChange={(e) => setTplSubject(e.target.value)}
                      />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-html">HTML Body Template</Label>
                    <Textarea
                      id="tpl-html"
                      rows={6}
                      value={tplBodyHtml}
                      disabled={!canManageTemplates}
                      onChange={(e) => setTplBodyHtml(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="tpl-text">Plain-Text Fallback Template</Label>
                    <Textarea
                      id="tpl-text"
                      rows={4}
                      value={tplBodyText}
                      disabled={!canManageTemplates}
                      onChange={(e) => setTplBodyText(e.target.value)}
                      className="font-mono text-xs"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* Live Branded HTML Preview */}
              <Card>
                <CardHeader className="pb-2">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <Eye className="size-4 text-muted-foreground" />
                      Live Branded Preview (Sample Candidate Context)
                    </CardTitle>
                    <div className="flex flex-wrap gap-1" role="group" aria-label="Email preview mode">
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={previewMode === "desktop"}
                        variant={previewMode === "desktop" ? "default" : "outline"}
                        onClick={() => setPreviewMode("desktop")}
                      >
                        <Monitor className="mr-1 size-3.5" />
                        Desktop HTML
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={previewMode === "mobile"}
                        variant={previewMode === "mobile" ? "default" : "outline"}
                        onClick={() => setPreviewMode("mobile")}
                      >
                        <Smartphone className="mr-1 size-3.5" />
                        Mobile 375px
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        aria-pressed={previewMode === "text"}
                        variant={previewMode === "text" ? "default" : "outline"}
                        onClick={() => setPreviewMode("text")}
                      >
                        <AlignLeft className="mr-1 size-3.5" />
                        Plain Text
                      </Button>
                    </div>
                  </div>
                  <CardDescription>
                    Rendered Subject: <strong>{editorPreview.subject}</strong>
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {previewMode === "text" ? (
                    <pre className="h-80 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 font-mono text-xs text-foreground">
                      {editorPreview.bodyText}
                    </pre>
                  ) : (
                    <div className={previewMode === "mobile" ? "mx-auto max-w-[375px]" : ""}>
                      <iframe
                        title="Branded HR Email Preview"
                        sandbox=""
                        srcDoc={editorPreview.bodyHtml}
                        className="h-80 w-full rounded-md border border-border bg-zinc-100"
                      />
                    </div>
                  )}
                </CardContent>
              </Card>
            </div>
          </div>
        </TabsContent>

        {/* TAB 2: COMPOSE, BULK SEND & TEST EMAIL */}
        <TabsContent value="compose" className="space-y-4">
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={composeMode === "individual" ? "default" : "outline"}
              onClick={() => setComposeMode("individual")}
            >
              <Mail className="mr-1.5 size-3.5" />
              Individual Candidate
            </Button>
            <Button
              size="sm"
              variant={composeMode === "bulk" ? "default" : "outline"}
              onClick={() => setComposeMode("bulk")}
            >
              <Users className="mr-1.5 size-3.5" />
              Bulk Candidates
            </Button>
            <Button
              size="sm"
              variant={composeMode === "test" ? "default" : "outline"}
              onClick={() => setComposeMode("test")}
            >
              <Sparkles className="mr-1.5 size-3.5" />
              Send Test Email
            </Button>
          </div>

          <div className="grid gap-5 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader className="pb-3">
                <CardTitle className="text-base">
                  {composeMode === "individual"
                    ? "Compose Candidate Communication"
                    : composeMode === "bulk"
                      ? "Bulk Templated Candidate Dispatch"
                      : "Send [TEST] Verification Email"}
                </CardTitle>
                <CardDescription>
                  {composeMode === "bulk"
                    ? "Select candidates and a template. Each candidate's name, designation, department, and next IST interview slot are interpolated automatically."
                    : "Choose any HR template, review dynamic variables, save a draft, or dispatch via verified sender."}
                </CardDescription>
              </CardHeader>

              <CardContent className="space-y-4">
                <div className="space-y-1.5">
                  <Label htmlFor="compose-tpl">Email Template</Label>
                  <select
                    id="compose-tpl"
                    value={composeSlug}
                    onChange={(e) => setComposeSlug(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                  >
                    {templates.map((t) => (
                      <option key={t.slug} value={t.slug}>
                        {t.name} ({t.category})
                      </option>
                    ))}
                  </select>
                </div>

                {composeMode === "individual" ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="compose-cand">Select Candidate (Auto-Fill)</Label>
                      <select
                        id="compose-cand"
                        value={composeCandidateId}
                        onChange={(e) => handleSelectComposeCandidate(e.target.value)}
                        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
                      >
                        <option value="">Custom recipient / select candidate...</option>
                        {(data?.candidates ?? []).map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.fullName} ({c.candidateCode}) — {c.email}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="compose-email">Recipient Email</Label>
                      <Input
                        id="compose-email"
                        type="email"
                        value={composeRecipientEmail}
                        onChange={(e) => setComposeRecipientEmail(e.target.value)}
                        placeholder="candidate@example.com"
                      />
                    </div>
                  </div>
                ) : null}

                {composeMode === "test" ? (
                  <div className="space-y-1.5">
                    <Label htmlFor="test-email">
                      Test Recipient Email (Prefixed with [TEST])
                    </Label>
                    <Input
                      id="test-email"
                      type="email"
                      value={composeRecipientEmail}
                      onChange={(e) => setComposeRecipientEmail(e.target.value)}
                      placeholder="hr-tester@theaischool.in"
                    />
                  </div>
                ) : null}

                {composeMode === "bulk" ? (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Label>
                        Select Candidates ({bulkCandidateIds.length} selected)
                      </Label>
                      <div className="flex gap-2">
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setBulkCandidateIds(
                              (data?.candidates ?? [])
                                .filter((c) => {
                                  const q = bulkSearch.trim().toLowerCase();
                                  if (!q) return true;
                                  return (
                                    c.fullName.toLowerCase().includes(q) ||
                                    c.email.toLowerCase().includes(q) ||
                                    c.status.toLowerCase().includes(q)
                                  );
                                })
                                .slice(0, 100)
                                .map((c) => c.id),
                            )
                          }
                        >
                          Select Filtered
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="ghost"
                          onClick={() => setBulkCandidateIds([])}
                        >
                          Clear
                        </Button>
                      </div>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute top-2.5 left-2.5 size-3.5 text-muted-foreground" />
                      <Input
                        aria-label="Filter bulk candidates"
                        value={bulkSearch}
                        onChange={(e) => setBulkSearch(e.target.value)}
                        placeholder="Filter candidates by name, email, or stage..."
                        className="h-8 pl-8 text-xs"
                      />
                    </div>
                    <div className="max-h-48 space-y-1 overflow-y-auto rounded-md border border-border p-2.5">
                      {(data?.candidates ?? []).length === 0 ? (
                        <p className="py-4 text-center text-xs text-muted-foreground">
                          No candidates available yet.
                        </p>
                      ) : (
                        (data?.candidates ?? [])
                          .filter((c) => {
                            const q = bulkSearch.trim().toLowerCase();
                            if (!q) return true;
                            return (
                              c.fullName.toLowerCase().includes(q) ||
                              c.email.toLowerCase().includes(q) ||
                              c.status.toLowerCase().includes(q)
                            );
                          })
                          .map((c) => (
                            <label
                              key={c.id}
                              className="flex cursor-pointer items-center justify-between gap-2 rounded px-2 py-1 text-xs hover:bg-muted/50"
                            >
                              <span className="flex min-w-0 items-center gap-2">
                                <Checkbox
                                  checked={bulkCandidateIds.includes(c.id)}
                                  onCheckedChange={() => toggleBulkCandidate(c.id)}
                                />
                                <span className="truncate font-medium text-foreground">
                                  {c.fullName}
                                </span>
                                <span className="truncate text-muted-foreground">({c.email})</span>
                              </span>
                              <Badge variant="outline" className="shrink-0 text-[10px]">
                                {c.status}
                              </Badge>
                            </label>
                          ))
                      )}
                    </div>
                  </div>
                ) : null}

                {/* Variable Values Grid */}
                <div className="space-y-2 rounded-lg border border-border p-3">
                  <p className="text-xs font-semibold text-foreground">
                    {composeMode === "bulk"
                      ? "Shared Fallback Variables (Used when candidate/interview field is blank)"
                      : "Dynamic Variable Values"}
                  </p>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    {(
                      [
                        "candidate_name",
                        "designation",
                        "department",
                        "interview_date",
                        "interview_time",
                        "meeting_link",
                        "joining_date",
                        "employee_id",
                        "hr_contact",
                      ] as EmailVariableKey[]
                    ).map((key) => (
                      <div key={key} className="space-y-1">
                        <Label htmlFor={`var-${key}`} className="font-mono text-[11px]">
                          {`{{${key}}}`}
                        </Label>
                        <Input
                          id={`var-${key}`}
                          value={composeVars[key] ?? ""}
                          onChange={(e) =>
                            setComposeVars((prev) => ({
                              ...prev,
                              [key]: e.target.value,
                            }))
                          }
                          className="h-8 text-xs"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {composePreview.missingVariables.length > 0 && composeMode !== "bulk" ? (
                  <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-200">
                    Missing values for:{" "}
                    <strong>
                      {composePreview.missingVariables
                        .map((v) => `{{${v}}}`)
                        .join(", ")}
                    </strong>
                  </div>
                ) : null}

                {/* Action Buttons */}
                <div className="flex flex-wrap items-center justify-end gap-2 pt-2">
                  {composeMode === "individual" && canSendEmails ? (
                    <Button
                      variant="outline"
                      onClick={handleSaveDraft}
                      disabled={dispatchBusy || !data?.schemaReady}
                    >
                      <Save className="mr-1.5 size-3.5" />
                      Save Draft
                    </Button>
                  ) : null}

                  {composeMode === "individual" ? (
                    <Button
                      onClick={() => handleSendIndividualOrTest(false)}
                      disabled={
                        !canSendEmails ||
                        !providerConfigured ||
                        dispatchBusy ||
                        !data?.schemaReady
                      }
                    >
                      <Send className="mr-1.5 size-3.5" />
                      {dispatchBusy ? "Sending..." : "Send Email"}
                    </Button>
                  ) : null}

                  {composeMode === "test" ? (
                    <Button
                      onClick={() => handleSendIndividualOrTest(true)}
                      disabled={
                        !canSendEmails ||
                        !providerConfigured ||
                        dispatchBusy ||
                        !data?.schemaReady
                      }
                    >
                      <Send className="mr-1.5 size-3.5" />
                      {dispatchBusy ? "Sending..." : "Send [TEST] Email"}
                    </Button>
                  ) : null}

                  {composeMode === "bulk" ? (
                    <Button
                      onClick={() => setBulkConfirmOpen(true)}
                      disabled={
                        !canSendEmails ||
                        !providerConfigured ||
                        bulkCandidateIds.length === 0 ||
                        dispatchBusy ||
                        !data?.schemaReady
                      }
                    >
                      <Send className="mr-1.5 size-3.5" />
                      {dispatchBusy
                        ? "Dispatching Batch..."
                        : `Send Bulk (${bulkCandidateIds.length})`}
                    </Button>
                  ) : null}
                </div>
              </CardContent>
            </Card>

            {/* Right Live Rendered Preview */}
            <Card className="lg:col-span-5">
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <CardTitle className="text-base">Rendered Message Preview</CardTitle>
                  <div className="flex flex-wrap gap-1" role="group" aria-label="Compose preview mode">
                    <Button
                      type="button"
                      size="sm"
                      aria-pressed={previewMode === "desktop"}
                      variant={previewMode === "desktop" ? "default" : "outline"}
                      onClick={() => setPreviewMode("desktop")}
                    >
                      Desktop
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      aria-pressed={previewMode === "mobile"}
                      variant={previewMode === "mobile" ? "default" : "outline"}
                      onClick={() => setPreviewMode("mobile")}
                    >
                      375px
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      aria-pressed={previewMode === "text"}
                      variant={previewMode === "text" ? "default" : "outline"}
                      onClick={() => setPreviewMode("text")}
                    >
                      Text
                    </Button>
                  </div>
                </div>
                <CardDescription>
                  Subject: <strong>{composePreview.subject}</strong>
                </CardDescription>
              </CardHeader>
              <CardContent>
                {previewMode === "text" ? (
                  <pre className="h-[460px] overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-muted/30 p-4 font-mono text-xs text-foreground">
                    {composePreview.bodyText}
                  </pre>
                ) : (
                  <div className={previewMode === "mobile" ? "mx-auto max-w-[375px]" : ""}>
                    <iframe
                      title="Compose Email Preview"
                      sandbox=""
                      srcDoc={composePreview.bodyHtml}
                      className="h-[460px] w-full rounded-md border border-border bg-zinc-100"
                    />
                  </div>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        {/* TAB 3: DELIVERY STATUS, FAILURE LOGS & RETRY */}
        <TabsContent value="logs" className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Drafts</CardDescription>
                <CardTitle className="text-2xl">{data?.stats.draft ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Saved drafts awaiting dispatch
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Sent (Provider Accepted)</CardDescription>
                <CardTitle className="text-2xl">{data?.stats.sent ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Accepted by Resend API (HTTP 2xx)
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Delivered (Webhook Confirmed)</CardDescription>
                <CardTitle className="text-2xl">{data?.stats.delivered ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Confirmed only via provider delivery event
              </CardContent>
            </Card>

            <Card>
              <CardHeader className="pb-2">
                <CardDescription className="flex items-center justify-between">
                  <span>Failed Dispatches</span>
                  <XCircle className="size-4 text-rose-600" />
                </CardDescription>
                <CardTitle className="text-2xl">{data?.stats.failed ?? 0}</CardTitle>
              </CardHeader>
              <CardContent className="text-xs text-muted-foreground">
                Logged errors eligible for safe retry
              </CardContent>
            </Card>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap gap-1.5">
              {(["all", "sent", "delivered", "failed", "draft"] as const).map((f) => (
                <Button
                  key={f}
                  size="sm"
                  aria-pressed={logFilter === f}
                  variant={logFilter === f ? "default" : "outline"}
                  onClick={() => setLogFilter(f)}
                  className="capitalize"
                >
                  {f}
                </Button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground">
              Honest Delivery Policy: messages remain <code>sent</code> until provider
              webhook confirmation promotes them to <code>delivered</code>.
            </p>
          </div>

          <Card>
            <CardContent className="pt-5">
              {filteredMessages.length === 0 ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  No email records match this filter.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Recipient</th>
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Subject &amp; Template</th>
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Status</th>
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Attempts</th>
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Provider / Error Detail</th>
                        <th scope="col" className="pb-2.5 pr-3 font-medium">Timestamp</th>
                        <th scope="col" className="pb-2.5 text-right font-medium">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border/60">
                      {filteredMessages.map((msg) => (
                        <tr key={msg.id} className="align-top">
                          <td className="py-3 pr-3">
                            <div className="font-medium text-foreground">
                              {msg.recipient_name ?? msg.recipient_email}
                            </div>
                            <div className="text-muted-foreground">
                              {msg.recipient_email}
                            </div>
                          </td>
                          <td className="py-3 pr-3">
                            <div className="font-medium text-foreground">
                              {msg.subject}
                            </div>
                            {msg.template_slug ? (
                              <code className="text-[11px] text-muted-foreground">
                                {msg.template_slug}
                              </code>
                            ) : null}
                          </td>
                          <td className="py-3 pr-3">
                            <Badge variant={statusBadgeVariant(msg.status)}>
                              {statusDisplayLabel(msg.status)}
                            </Badge>
                          </td>
                          <td className="py-3 pr-3">{msg.attempts}</td>
                          <td className="max-w-xs py-3 pr-3">
                            {msg.error_message ? (
                              <span className="text-rose-600 dark:text-rose-400">
                                {msg.error_message}
                              </span>
                            ) : msg.provider_message_id ? (
                              <code className="text-[11px] text-muted-foreground">
                                {msg.provider_message_id}
                              </code>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td className="py-3 pr-3 whitespace-nowrap text-muted-foreground">
                            {new Date(msg.sent_at ?? msg.created_at).toLocaleString(
                              "en-IN",
                              { timeZone: "Asia/Kolkata" },
                            )}
                          </td>
                          <td className="py-3 text-right">
                            {canSendEmails &&
                            (msg.status === "failed" || msg.status === "draft") ? (
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={!providerConfigured || retryingId === msg.id}
                                onClick={() => handleRetryMessage(msg.id)}
                              >
                                {msg.status === "draft" ? (
                                  <Send className="mr-1 size-3" />
                                ) : (
                                  <RotateCcw className="mr-1 size-3" />
                                )}
                                {retryingId === msg.id
                                  ? msg.status === "draft"
                                    ? "Sending..."
                                    : "Retrying..."
                                  : msg.status === "draft"
                                    ? "Send Draft"
                                    : "Retry"}
                              </Button>
                            ) : null}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Reset Template Default Confirmation */}
      <AlertDialog open={resetConfirmOpen} onOpenChange={setResetConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Reset &ldquo;{activeTemplate?.name}&rdquo; to Standard Default?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Replaces any custom subject, HTML body, and plain-text overrides for{" "}
              <code className="font-mono">{activeTemplate?.slug}</code> with The AI School standard
              template.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={savingTemplate}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={savingTemplate}
              onClick={() => {
                setResetConfirmOpen(false);
                void handleResetTemplate();
              }}
            >
              Reset Template
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Bulk Email Dispatch Confirmation */}
      <AlertDialog open={bulkConfirmOpen} onOpenChange={setBulkConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              Send Bulk Email to {bulkCandidateIds.length} Candidate(s)?
            </AlertDialogTitle>
            <AlertDialogDescription>
              Dispatches template{" "}
              <strong>
                {templates.find((t) => t.slug === composeSlug)?.name ?? composeSlug}
              </strong>{" "}
              via verified Resend sender with per-recipient variable interpolation and duplicate
              protection.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={dispatchBusy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={dispatchBusy}
              onClick={() => {
                setBulkConfirmOpen(false);
                void handleSendBulk();
              }}
            >
              Confirm Bulk Send
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppShell>
  );
}
