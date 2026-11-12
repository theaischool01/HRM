export const SUPPORTED_EMAIL_VARIABLES = [
  "candidate_name",
  "designation",
  "department",
  "interview_date",
  "interview_time",
  "meeting_link",
  "hr_contact",
  "joining_date",
  "employee_id",
  "interview_mode",
  "office_location",
  "portal_url",
] as const;

export type EmailVariableKey = (typeof SUPPORTED_EMAIL_VARIABLES)[number];

export const EMAIL_VARIABLE_DESCRIPTIONS: Record<EmailVariableKey, string> = {
  candidate_name: "Candidate's full name",
  designation: "Role / job title applied or offered",
  department: "Department name",
  interview_date: "Scheduled interview date in IST",
  interview_time: "Scheduled interview time range in IST",
  meeting_link: "Video meeting URL or in-office location instructions",
  hr_contact: "HR representative name or contact email",
  joining_date: "Proposed or confirmed joining date",
  employee_id: "Assigned sequential TAS-XXX Employee ID",
  interview_mode: "Online or Offline",
  office_location: "Office location name/address (for offline interviews)",
  portal_url: "The AI School HRM portal URL",
};

export const SAMPLE_EMAIL_VARIABLES: Record<EmailVariableKey, string> = {
  candidate_name: "Ananya Krishnan",
  designation: "Senior AI Trainer",
  department: "Operations",
  interview_date: "18 Nov 2026",
  interview_time: "03:00 PM – 03:45 PM IST",
  meeting_link: "https://meet.google.com/abc-defg-hij",
  hr_contact: "HR Team (hr@theaischool.in)",
  joining_date: "01 Dec 2026",
  employee_id: "TAS-042",
  interview_mode: "Online",
  office_location: "The AI School HQ, Bengaluru",
  portal_url: "https://hrm.theaischool.co",
};

export type EmailTemplateDefinition = {
  slug: string;
  name: string;
  category: "screening" | "interviews" | "decisions" | "offers" | "onboarding";
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  bodyTextTemplate: string;
  variables: EmailVariableKey[];
};

export const DEFAULT_EMAIL_TEMPLATES: readonly EmailTemplateDefinition[] = [
  {
    slug: "application_received",
    name: "Application Received",
    category: "screening",
    subjectTemplate: "Application Received — {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Thank you for applying for the <strong>{{designation}}</strong> role ({{department}}) at <strong>The AI School</strong>.</p><p>Our recruitment team has received your profile and will review your qualifications shortly. If your background aligns with our current requirements, we will reach out to schedule an initial conversation.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nThank you for applying for the {{designation}} role ({{department}}) at The AI School.\n\nOur recruitment team has received your profile and will review your qualifications shortly.\n\nWarm regards,\n{{hr_contact}}\nHR Team · The AI School",
    variables: ["candidate_name", "designation", "department", "hr_contact"],
  },
  {
    slug: "candidate_shortlisted",
    name: "Candidate Shortlisted",
    category: "screening",
    subjectTemplate: "Your Application Has Been Shortlisted — {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>We are pleased to share that your profile has been shortlisted for the <strong>{{designation}}</strong> position in our <strong>{{department}}</strong> team at The AI School.</p><p>Our HR team will contact you shortly to coordinate convenient slots for the upcoming interview round.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nYour profile has been shortlisted for the {{designation}} position ({{department}}) at The AI School. Our HR team will reach out shortly to coordinate interview slots.\n\nBest regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "hr_contact"],
  },
  {
    slug: "interview_invitation",
    name: "Interview Invitation",
    category: "interviews",
    subjectTemplate: "Interview Invitation: {{designation}} on {{interview_date}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>You are invited to an interview for the <strong>{{designation}}</strong> ({{department}}) role at <strong>The AI School</strong>.</p><ul><li><strong>Date:</strong> {{interview_date}}</li><li><strong>Time (IST):</strong> {{interview_time}}</li><li><strong>Mode / Link:</strong> {{meeting_link}}</li></ul><p>Please reply to confirm your availability or reach out to {{hr_contact}} if you need assistance.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nYou are invited to an interview for {{designation}} ({{department}}) at The AI School.\n- Date: {{interview_date}}\n- Time (IST): {{interview_time}}\n- Mode / Link: {{meeting_link}}\n\nBest regards,\n{{hr_contact}}",
    variables: [
      "candidate_name",
      "designation",
      "department",
      "interview_date",
      "interview_time",
      "meeting_link",
      "hr_contact",
    ],
  },
  {
    slug: "interview_rescheduled",
    name: "Interview Rescheduled",
    category: "interviews",
    subjectTemplate:
      "Updated Schedule: Interview for {{designation}} on {{interview_date}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Your interview for the <strong>{{designation}}</strong> ({{department}}) role at The AI School has been rescheduled. Please note the updated details below:</p><ul><li><strong>New Date:</strong> {{interview_date}}</li><li><strong>New Time (IST):</strong> {{interview_time}}</li><li><strong>Mode / Link:</strong> {{meeting_link}}</li></ul><p>If you have any questions, please contact {{hr_contact}}.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nYour interview for {{designation}} ({{department}}) has been rescheduled:\n- New Date: {{interview_date}}\n- New Time (IST): {{interview_time}}\n- Mode / Link: {{meeting_link}}\n\nWarm regards,\n{{hr_contact}}",
    variables: [
      "candidate_name",
      "designation",
      "department",
      "interview_date",
      "interview_time",
      "meeting_link",
      "hr_contact",
    ],
  },
  {
    slug: "interview_reminder",
    name: "Interview Reminder",
    category: "interviews",
    subjectTemplate:
      "Reminder: Upcoming Interview for {{designation}} ({{interview_date}}) | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>This is a friendly reminder regarding your upcoming interview for <strong>{{designation}}</strong> ({{department}}) at The AI School.</p><ul><li><strong>Date:</strong> {{interview_date}}</li><li><strong>Time (IST):</strong> {{interview_time}}</li><li><strong>Join / Location Details:</strong> {{meeting_link}}</li></ul><p>We look forward to speaking with you!</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nReminder for your upcoming interview for {{designation}} ({{department}}):\n- Date: {{interview_date}}\n- Time (IST): {{interview_time}}\n- Join / Location Details: {{meeting_link}}\n\nBest regards,\n{{hr_contact}}",
    variables: [
      "candidate_name",
      "designation",
      "department",
      "interview_date",
      "interview_time",
      "meeting_link",
      "hr_contact",
    ],
  },
  {
    slug: "candidate_rejection",
    name: "Candidate Rejection",
    category: "decisions",
    subjectTemplate: "Update on Your Application for {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Thank you for taking the time to apply and speak with our team regarding the <strong>{{designation}}</strong> role in <strong>{{department}}</strong> at The AI School.</p><p>After careful evaluation, we have decided to move forward with other candidates whose experience more closely aligns with our immediate needs. We truly appreciate your interest in The AI School and wish you every success ahead.</p><p>Sincerely,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nThank you for applying for the {{designation}} ({{department}}) role at The AI School. After careful consideration, we have decided to move forward with other candidates at this time. We wish you the very best.\n\nSincerely,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "hr_contact"],
  },
  {
    slug: "candidate_selection",
    name: "Candidate Selection",
    category: "decisions",
    subjectTemplate: "Congratulations! Selected for {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Congratulations! Following your interviews with our team, we are delighted to inform you that you have been selected for the <strong>{{designation}}</strong> role in <strong>{{department}}</strong> at <strong>The AI School</strong>.</p><p>Our HR team is preparing your formal offer details with a proposed joining date of <strong>{{joining_date}}</strong>. Please reach out to {{hr_contact}} if you need any clarification.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nCongratulations! You have been selected for the {{designation}} ({{department}}) role at The AI School, with a proposed joining date of {{joining_date}}.\n\nWarm regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "joining_date", "hr_contact"],
  },
  {
    slug: "offer_letter",
    name: "Offer Letter",
    category: "offers",
    subjectTemplate: "Offer of Engagement — {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>We are excited to extend an offer to join <strong>The AI School</strong> as <strong>{{designation}}</strong> in our <strong>{{department}}</strong> department, with an anticipated joining date of <strong>{{joining_date}}</strong>.</p><p>Please review your offer terms and reply to confirm your acceptance so we can initiate your HRM portal onboarding.</p><p>For any queries, please contact {{hr_contact}}.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nWe are excited to extend an offer to join The AI School as {{designation}} ({{department}}) starting {{joining_date}}. Please reply to confirm your acceptance.\n\nBest regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "joining_date", "hr_contact"],
  },
  {
    slug: "offer_acceptance",
    name: "Offer Acceptance",
    category: "offers",
    subjectTemplate:
      "Offer Acceptance Confirmed — Welcome to Pre-Onboarding | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Thank you for accepting our offer to join <strong>The AI School</strong> as <strong>{{designation}}</strong> ({{department}}) starting on <strong>{{joining_date}}</strong>!</p><p>We will shortly issue your HRM onboarding invitation so you can complete your profile and upload required verification documents ahead of Day 1.</p><p>Warm regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nThank you for accepting our offer for {{designation}} ({{department}}) starting {{joining_date}}. Your HRM onboarding invitation will follow shortly.\n\nWarm regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "joining_date", "hr_contact"],
  },
  {
    slug: "onboarding_invitation",
    name: "Onboarding Invitation",
    category: "onboarding",
    subjectTemplate: "Complete Your Pre-Joining Onboarding — {{designation}} | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Welcome to the onboarding stage for <strong>{{designation}}</strong> ({{department}}) at <strong>The AI School</strong> (Joining Date: <strong>{{joining_date}}</strong>).</p><p>Your HRM portal invitation has been queued. Once you receive your secure sign-in link, please complete your profile details and upload your mandatory KYC documents for HR verification.</p><p>Need help? Contact {{hr_contact}}.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nWelcome to onboarding for {{designation}} ({{department}}), joining {{joining_date}}. Please accept your HRM portal invite link and upload your KYC verification documents.\n\nBest regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "joining_date", "hr_contact"],
  },
  {
    slug: "document_reminder",
    name: "Document Reminder",
    category: "onboarding",
    subjectTemplate: "Action Required: Pending Onboarding Documents | The AI School",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>This is a gentle reminder to upload your pending onboarding &amp; KYC verification documents on The AI School HRM portal ahead of your joining date (<strong>{{joining_date}}</strong>) as <strong>{{designation}}</strong> ({{department}}).</p><p>Your employee account is activated once all required documents are verified by HR. Reach out to {{hr_contact}} if you face any issues.</p><p>Best regards,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nPlease complete uploading your pending onboarding & KYC documents on The AI School HRM portal ahead of {{joining_date}} ({{designation}}, {{department}}).\n\nBest regards,\n{{hr_contact}}",
    variables: ["candidate_name", "designation", "department", "joining_date", "hr_contact"],
  },
  {
    slug: "employee_welcome",
    name: "Employee Welcome",
    category: "onboarding",
    subjectTemplate: "Welcome to The AI School — Employee ID {{employee_id}}",
    bodyHtmlTemplate:
      "<p>Dear {{candidate_name}},</p><p>Welcome officially to <strong>The AI School</strong>! Your onboarding as <strong>{{designation}}</strong> in <strong>{{department}}</strong> (Joining Date: <strong>{{joining_date}}</strong>) is underway with Employee ID <strong>{{employee_id}}</strong>.</p><p>Sign in to the HRM portal to view your assigned projects, record daily attendance, log hourly tasks, and submit End-of-Day updates.</p><p>Warmest welcome,<br/>{{hr_contact}}<br/>HR Team · The AI School</p>",
    bodyTextTemplate:
      "Dear {{candidate_name}},\n\nWelcome officially to The AI School! Role: {{designation}} ({{department}}), Employee ID: {{employee_id}}, Joining Date: {{joining_date}}.\n\nWarmest welcome,\n{{hr_contact}}",
    variables: [
      "candidate_name",
      "designation",
      "department",
      "joining_date",
      "employee_id",
      "hr_contact",
    ],
  },
] as const;

const PLACEHOLDER_RE = /\{\{\s*([a-zA-Z0-9_.-]+)\s*\}\}/g;
const SUPPORTED_SET = new Set<string>(SUPPORTED_EMAIL_VARIABLES);

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

export function extractTemplateVariables(templateText: string): string[] {
  const found = new Set<string>();
  for (const match of templateText.matchAll(PLACEHOLDER_RE)) {
    if (match[1]) found.add(match[1]);
  }
  return Array.from(found);
}

export function validateTemplateVariables(params: {
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  bodyTextTemplate?: string | null | undefined;
}): {
  valid: boolean;
  usedVariables: EmailVariableKey[];
  unknownVariables: string[];
} {
  const allTokens = new Set<string>([
    ...extractTemplateVariables(params.subjectTemplate),
    ...extractTemplateVariables(params.bodyHtmlTemplate),
    ...(params.bodyTextTemplate ? extractTemplateVariables(params.bodyTextTemplate) : []),
  ]);

  const usedVariables: EmailVariableKey[] = [];
  const unknownVariables: string[] = [];

  for (const token of allTokens) {
    if (SUPPORTED_SET.has(token)) {
      usedVariables.push(token as EmailVariableKey);
    } else {
      unknownVariables.push(token);
    }
  }

  return {
    valid: unknownVariables.length === 0,
    usedVariables,
    unknownVariables,
  };
}

export function stripHtmlToText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "- ")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function wrapBrandedEmailHtml(subject: string, innerHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:24px 12px;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#18181b;">
  <div style="max-width:580px;margin:0 auto;background:#ffffff;border:1px solid #e4e4e7;border-radius:10px;overflow:hidden;">
    <div style="padding:20px 28px;border-bottom:3px solid #e11d48;background:#ffffff;">
      <strong style="font-size:18px;letter-spacing:-0.3px;color:#09090b;">THE <span style="color:#e11d48;">AI SCHOOL</span></strong>
      <span style="float:right;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.6px;">HR &amp; Talent</span>
    </div>
    <div style="padding:28px;font-size:15px;line-height:1.65;color:#27272a;">
      ${innerHtml}
    </div>
    <div style="padding:16px 28px;background:#fafafa;border-top:1px solid #e4e4e7;font-size:12px;color:#71717a;">
      &copy; ${new Date().getUTCFullYear()} The AI School · Official Recruitment &amp; Onboarding Communication
    </div>
  </div>
</body>
</html>`;
}

/**
 * Interpolates template variables safely:
 * - Escapes HTML special characters inside `bodyHtml` to prevent XSS/HTML injection.
 * - Preserves plain text inside `subject` and `bodyText`.
 * - Reports any missing required variables whose value resolved to empty string.
 */
export function renderEmailTemplate(params: {
  subjectTemplate: string;
  bodyHtmlTemplate: string;
  bodyTextTemplate?: string | null | undefined;
  variables: Partial<Record<EmailVariableKey, string | null | undefined>>;
  wrapInBrandLayout?: boolean | undefined;
}): {
  ok: boolean;
  subject: string;
  bodyHtml: string;
  bodyText: string;
  missingVariables: string[];
  unknownVariables: string[];
} {
  const check = validateTemplateVariables({
    subjectTemplate: params.subjectTemplate,
    bodyHtmlTemplate: params.bodyHtmlTemplate,
    bodyTextTemplate: params.bodyTextTemplate,
  });

  const missingSet = new Set<string>();

  const replacePlain = (tpl: string) =>
    tpl.replace(PLACEHOLDER_RE, (_full, key: string) => {
      if (!SUPPORTED_SET.has(key)) return `{{${key}}}`;
      const raw = params.variables[key as EmailVariableKey];
      const val = String(raw ?? "").trim();
      if (!val) {
        missingSet.add(key);
        return "";
      }
      return val;
    });

  const replaceHtml = (tpl: string) =>
    tpl.replace(PLACEHOLDER_RE, (_full, key: string) => {
      if (!SUPPORTED_SET.has(key)) return escapeHtml(`{{${key}}}`);
      const raw = params.variables[key as EmailVariableKey];
      const val = String(raw ?? "").trim();
      if (!val) {
        missingSet.add(key);
        return "";
      }
      return escapeHtml(val);
    });

  const subject = replacePlain(params.subjectTemplate).replace(/\s+/g, " ").trim();
  const renderedInnerHtml = replaceHtml(params.bodyHtmlTemplate);
  const bodyHtml =
    params.wrapInBrandLayout === false
      ? renderedInnerHtml
      : wrapBrandedEmailHtml(subject, renderedInnerHtml);
  const bodyText = params.bodyTextTemplate
    ? replacePlain(params.bodyTextTemplate)
    : stripHtmlToText(renderedInnerHtml);

  const missingVariables = Array.from(missingSet);

  return {
    ok: check.valid && missingVariables.length === 0 && subject.length > 0,
    subject,
    bodyHtml,
    bodyText,
    missingVariables,
    unknownVariables: check.unknownVariables,
  };
}

/**
 * Deterministic idempotency key for email sends so accidental double-clicks or
 * network retries within the same bucket never dispatch duplicate emails.
 */
export function buildEmailIdempotencyKey(params: {
  templateSlug: string | null | undefined;
  recipientEmail: string;
  candidateId?: string | null | undefined;
  interviewId?: string | null | undefined;
  subject: string;
  dedupeToken?: string | undefined;
}): string {
  const parts = [
    params.templateSlug || "custom",
    params.recipientEmail.trim().toLowerCase(),
    params.candidateId || "no-candidate",
    params.interviewId || "no-interview",
    params.dedupeToken || params.subject.trim().toLowerCase().slice(0, 48),
  ];
  return parts
    .join(":")
    .replace(/[^a-z0-9:_@.-]+/gi, "-")
    .slice(0, 240);
}

