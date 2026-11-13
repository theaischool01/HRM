import { renderWelcomeEmailHtml } from "./welcome-email";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { CATEGORY_LABELS, ROLE_LABELS, type AppRole, type UserCategory } from "@/lib/permissions";
import {
  createHostingerSmtpTransport,
  inspectEmailProviderConfig,
} from "@/lib/recruitment/email-transport.server";

export async function sendWelcomeEmailForProvisionedUser(params: {
  userId: string;
  fullName: string;
  workEmail: string;
  employeeCode: string;
  category: string;
  role: string;
  portalUrl?: string;
}): Promise<{ sent: boolean; reason?: string }> {
  try {
    // 1. Check idempotency: don't re-send if already sent
    const { data: profile } = await supabaseAdmin
      .from("profiles")
      .select("welcome_email_sent_at")
      .eq("id", params.userId)
      .maybeSingle();

    if (profile?.welcome_email_sent_at) {
      return { sent: false, reason: "already-sent" };
    }

    // 2. Verify real email-provider configuration before attempting to send
    const providerStatus = inspectEmailProviderConfig();
    if (!providerStatus.configured) {
      return { sent: false, reason: "email-provider-not-configured" };
    }

    const portalUrl =
      params.portalUrl ||
      process.env["SITE_URL"] ||
      process.env["VITE_SITE_URL"] ||
      "https://hrm.theaischool.co";

    const html = renderWelcomeEmailHtml({
      fullName: params.fullName,
      workEmail: params.workEmail,
      employeeCode: params.employeeCode,
      categoryLabel: CATEGORY_LABELS[params.category as UserCategory] ?? params.category,
      roleLabel: ROLE_LABELS[params.role as AppRole] ?? params.role,
      portalUrl,
    });

    const transport = createHostingerSmtpTransport();
    const dispatchResult = await transport.send({
      to: params.workEmail,
      subject: `Welcome to The AI School — Employee ID ${params.employeeCode}`,
      html,
      idempotencyKey: `employee-welcome:${params.userId}:${params.employeeCode}`,
    });

    if (!dispatchResult.ok) {
      console.error("[welcome-email] Provider rejected welcome email:", dispatchResult.errorMessage);
      return { sent: false, reason: dispatchResult.errorMessage };
    }

    // Only mark welcome_email_sent_at after real provider acceptance ("sent")
    await supabaseAdmin
      .from("profiles")
      .update({ welcome_email_sent_at: new Date().toISOString() })
      .eq("id", params.userId);

    return { sent: true };
  } catch (error) {
    console.error("[welcome-email] Failed to dispatch welcome email:", error);
    return { sent: false, reason: String(error) };
  }
}
