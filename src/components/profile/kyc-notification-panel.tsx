import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { CheckCircle2, History, Mail, RefreshCw, Send, ShieldCheck, TriangleAlert } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  getKycReviewSummary,
  previewKycEmail,
  retryKycNotification,
  sendKycEmail,
  type KycReviewSummary,
} from "@/lib/kyc.functions";
import type { KycEmailKind } from "@/lib/kyc/kyc-notifications";

type Preview = Awaited<ReturnType<typeof previewKycEmail>>;

const STATUS_TONE: Record<string, "success" | "warning" | "destructive" | "secondary" | "outline"> = {
  verified: "success",
  under_review: "warning",
  correction_required: "destructive",
  incomplete: "secondary",
  not_started: "outline",
};

const DOC_TONE: Record<string, string> = {
  verified: "text-emerald-600 dark:text-emerald-400",
  rejected: "text-destructive",
  submitted: "text-amber-600 dark:text-amber-400",
  resubmitted: "text-amber-600 dark:text-amber-400",
  not_uploaded: "text-muted-foreground",
};

const DOC_STATE_LABEL: Record<string, string> = {
  verified: "Verified",
  rejected: "Correction required",
  submitted: "Submitted · Under review",
  resubmitted: "Resubmitted · Under review",
  not_uploaded: "Not uploaded",
};

const KIND_LABEL: Record<KycEmailKind, string> = {
  verified: "KYC success",
  correction: "Correction request",
};

function fmt(ts: string | null | undefined): string {
  if (!ts) return "—";
  return new Date(ts).toLocaleString("en-IN", { timeZone: "Asia/Kolkata", dateStyle: "medium", timeStyle: "short" });
}

export function KycNotificationPanel({ userId }: { userId: string }) {
  const queryClient = useQueryClient();
  const queryKey = ["kyc-review", userId];
  const summaryQuery = useQuery({ queryKey, queryFn: () => getKycReviewSummary({ data: { userId } }) });
  const [preview, setPreview] = useState<(Preview & { kind: KycEmailKind; resend: boolean }) | null>(null);
  const [busy, setBusy] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const s: KycReviewSummary | undefined = summaryQuery.data;

  async function openPreview(kind: KycEmailKind, resend = false) {
    setBusy(true);
    try {
      const p = await previewKycEmail({ data: { userId, kind } });
      setPreview({ ...p, kind, resend });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not prepare the email preview.");
    } finally {
      setBusy(false);
    }
  }

  async function confirmSend() {
    if (!preview) return;
    setBusy(true);
    try {
      const res = await sendKycEmail({ data: { userId, kind: preview.kind, confirmResend: preview.resend } });
      if (res.outcome === "sent") toast.success("Email accepted by Hostinger SMTP (not proof of inbox delivery).");
      else toast.error(`Email not delivered yet: ${res.reason}`);
      setPreview(null);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not send the email.");
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey });
    }
  }

  async function retry(outboxId: string) {
    setBusy(true);
    try {
      const res = await retryKycNotification({ data: { userId, outboxId } });
      toast.message(res ? `Retry: ${res.outcome} — ${res.reason}` : "Retry queued.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Retry failed.");
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey });
    }
  }

  return (
    <Card className="border-border">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center gap-2 text-base">
          <ShieldCheck className="size-4 text-primary" aria-hidden="true" /> KYC Verification &amp; Notifications
        </CardTitle>
        <CardDescription>
          Automatic emails are sent only on committed state changes. Manual sends use the same templates and rules.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {summaryQuery.isLoading ? (
          <p className="text-muted-foreground">Loading KYC status…</p>
        ) : summaryQuery.isError || !s ? (
          <p role="alert" className="text-destructive">
            {summaryQuery.error instanceof Error ? summaryQuery.error.message : "Could not load KYC status."}
          </p>
        ) : (
          <>
            {!s.schemaReady ? (
              <p className="flex items-start gap-2 rounded-md border border-amber-500/40 bg-amber-500/10 p-2.5 text-xs text-amber-700 dark:text-amber-300">
                <TriangleAlert className="mt-0.5 size-3.5 shrink-0" aria-hidden="true" />
                Automatic KYC notifications activate after the KYC outbox migration is approved and applied.
                Manual sends are unavailable until then.
              </p>
            ) : null}

            <div className="flex flex-wrap items-center gap-2">
              <Badge variant={STATUS_TONE[s.status] ?? "outline"}>{s.statusLabel}</Badge>
              <span className="text-xs text-muted-foreground">{s.progress}</span>
            </div>

            <ul className="divide-y divide-border rounded-md border border-border">
              {s.documents.map((d) => (
                <li key={d.docType} className="flex items-start justify-between gap-3 px-3 py-2">
                  <div className="min-w-0">
                    <p className="font-medium">{d.label}</p>
                    {d.reviewNote ? (
                      <p className="break-words text-xs text-muted-foreground">Reason: {d.reviewNote}</p>
                    ) : null}
                  </div>
                  <div className="shrink-0 text-right text-xs">
                    <span className={DOC_TONE[d.state] ?? ""}>{DOC_STATE_LABEL[d.state] ?? d.state}</span>
                    {d.revision > 1 ? <p className="text-muted-foreground">v{d.revision}</p> : null}
                  </div>
                </li>
              ))}
            </ul>

            <div className="space-y-1.5 rounded-md border border-border bg-muted/30 p-3 text-xs">
              <p>
                <span className="text-muted-foreground">Recipient:</span>{" "}
                <span className="font-mono">{s.recipient ?? "—"}</span>
              </p>
              <p>
                <span className="text-muted-foreground">Last KYC email:</span>{" "}
                {s.lastEmail
                  ? `${s.lastEmail.kind ? KIND_LABEL[s.lastEmail.kind] : "KYC"} · ${s.lastEmail.status} · ${fmt(s.lastEmail.sentAt ?? s.lastEmail.createdAt)}`
                  : "None sent"}
              </p>
              {s.lastEmail?.error ? <p className="text-destructive">Last error: {s.lastEmail.error}</p> : null}
            </div>

            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={busy || !s.schemaReady || !s.canSendVerified.allowed}
                title={s.canSendVerified.reason}
                onClick={() => void openPreview("verified")}
              >
                <CheckCircle2 className="mr-1.5 size-3.5" aria-hidden="true" /> Send KYC Success Email
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !s.schemaReady || !s.canSendCorrection.allowed}
                title={s.canSendCorrection.reason}
                onClick={() => void openPreview("correction")}
              >
                <Send className="mr-1.5 size-3.5" aria-hidden="true" /> Send Correction Request
              </Button>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={busy || !s.schemaReady || !s.lastEmail?.kind}
                onClick={() => s.lastEmail?.kind && void openPreview(s.lastEmail.kind, true)}
              >
                <RefreshCw className="mr-1.5 size-3.5" aria-hidden="true" /> Resend Last KYC Email
              </Button>
              <Button type="button" size="sm" variant="ghost" onClick={() => setShowHistory((v) => !v)}>
                <History className="mr-1.5 size-3.5" aria-hidden="true" /> {showHistory ? "Hide" : "View"} Email History
              </Button>
            </div>

            {showHistory ? (
              <div className="space-y-3">
                <div className="max-h-56 overflow-auto rounded-md border border-border">
                  <table className="w-full text-left text-xs">
                    <thead className="sticky top-0 bg-muted text-muted-foreground">
                      <tr>
                        <th className="px-2.5 py-1.5">Email</th>
                        <th className="px-2.5 py-1.5">Status</th>
                        <th className="px-2.5 py-1.5">Attempts</th>
                        <th className="px-2.5 py-1.5">When (IST)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {s.emailHistory.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-2.5 py-3 text-center text-muted-foreground">
                            No KYC emails yet.
                          </td>
                        </tr>
                      ) : (
                        s.emailHistory.map((e) => (
                          <tr key={e.id}>
                            <td className="px-2.5 py-1.5">{e.kind ? KIND_LABEL[e.kind] : e.subject}</td>
                            <td className="px-2.5 py-1.5">
                              {e.status}
                              {e.error ? <span className="block text-destructive">{e.error}</span> : null}
                            </td>
                            <td className="px-2.5 py-1.5">{e.attempts}</td>
                            <td className="px-2.5 py-1.5">{fmt(e.sentAt ?? e.createdAt)}</td>
                          </tr>
                        ))
                      )}
                    </tbody>
                  </table>
                </div>
                {s.outbox.length > 0 ? (
                  <div className="max-h-48 overflow-auto rounded-md border border-border">
                    <table className="w-full text-left text-xs">
                      <thead className="sticky top-0 bg-muted text-muted-foreground">
                        <tr>
                          <th className="px-2.5 py-1.5">Event</th>
                          <th className="px-2.5 py-1.5">Status</th>
                          <th className="px-2.5 py-1.5">Scheduled / processed</th>
                          <th className="px-2.5 py-1.5" />
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-border">
                        {s.outbox.map((o) => (
                          <tr key={o.id}>
                            <td className="px-2.5 py-1.5 font-mono">
                              {o.eventType.replace("kyc.", "")}
                              <span className="block font-sans text-muted-foreground">{o.source}</span>
                            </td>
                            <td className="px-2.5 py-1.5">
                              {o.status}
                              {o.skipReason ? <span className="block text-muted-foreground">{o.skipReason}</span> : null}
                              {o.lastError ? <span className="block text-destructive">{o.lastError}</span> : null}
                            </td>
                            <td className="px-2.5 py-1.5">{fmt(o.processedAt ?? o.availableAt)}</td>
                            <td className="px-2.5 py-1.5 text-right">
                              {o.status === "failed" ? (
                                <Button type="button" size="sm" variant="outline" className="h-7" disabled={busy} onClick={() => void retry(o.id)}>
                                  Retry
                                </Button>
                              ) : null}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        )}
      </CardContent>

      <Dialog open={preview !== null} onOpenChange={(open) => (!open ? setPreview(null) : undefined)}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Mail className="size-4 text-primary" aria-hidden="true" />
              {preview?.resend ? "Resend" : "Send"} {preview ? KIND_LABEL[preview.kind] : ""} email?
            </DialogTitle>
            <DialogDescription>Review the exact message before it is sent via hr@theaischool.co.</DialogDescription>
          </DialogHeader>
          {preview ? (
            <div className="space-y-3 text-xs">
              <div className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-1">
                <span className="text-muted-foreground">Recipient</span>
                <span className="font-mono">{preview.recipient}</span>
                <span className="text-muted-foreground">Subject</span>
                <span>{preview.subject}</span>
                <span className="text-muted-foreground">Template</span>
                <span className="font-mono">{preview.template}</span>
                <span className="text-muted-foreground">Document status</span>
                <span>{preview.progress}</span>
              </div>
              <iframe
                title="KYC email preview"
                sandbox=""
                srcDoc={preview.html}
                className="h-80 w-full rounded-md border border-border bg-white"
              />
              {preview.resend ? (
                <p className="text-amber-700 dark:text-amber-300">
                  This is a resend. The employee may already have received this message.
                </p>
              ) : null}
            </div>
          ) : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={() => setPreview(null)}>
              Cancel
            </Button>
            <Button type="button" disabled={busy} onClick={() => void confirmSend()}>
              {busy ? "Sending…" : preview?.resend ? "Confirm resend" : "Send email"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
