/**
 * TODO(email provider): wire this up once a provider is picked (Gmail/Google
 * Workspace SMTP via nodemailer, or a transactional API like Resend) — see
 * the bug-report pill feature. Until then this only logs, so a report never
 * throws or gets lost: it's already saved as a BugReport row (see the
 * /api/bug-reports route) regardless of whether the email goes out, and
 * `emailedAt` on that row stays null until a real send happens here.
 *
 * Destination is fixed: jose@evecompany.com.br.
 */
export interface BugReportEmailPayload {
  reporterName: string;
  reporterEmail: string;
  message: string;
  attachments: { filename: string; url: string }[];
  createdAt: Date;
}

const BUG_REPORT_RECIPIENT = 'jose@evecompany.com.br';

/** Returns whether it actually sent — the caller uses this to decide whether to stamp `emailedAt`. */
export async function sendBugReportEmail(payload: BugReportEmailPayload): Promise<boolean> {
  console.log(
    `[bug-report] e-mail para ${BUG_REPORT_RECIPIENT} ainda não configurado — reportado por ${payload.reporterName} <${payload.reporterEmail}>: ${payload.message.slice(0, 200)}`,
  );
  return false;
}
