import { getEnv } from '@eve/core';
import nodemailer from 'nodemailer';

/**
 * Bug reports go to jose@evecompany.com.br. The report is saved as a
 * BugReport row and announced in jose@'s bell before this runs (see
 * /api/bug-reports), so the e-mail is the extra copy: it only goes out when
 * SMTP_URL is set, and a failure here never loses the report — `emailedAt`
 * on the row just stays null.
 */
export const BUG_REPORT_RECIPIENT = 'jose@evecompany.com.br';

export interface BugReportEmailPayload {
  reporterName: string;
  reporterEmail: string;
  message: string;
  attachments: { filename: string; url: string }[];
  createdAt: Date;
}

/** The e-mail body: who, when, what, and every attachment as a link that opens outside the app. */
export function bugReportText(payload: BugReportEmailPayload, baseUrl: string | undefined): string {
  const when = payload.createdAt.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', dateStyle: 'short', timeStyle: 'short' });
  const links = payload.attachments.map((attachment) => `- ${attachment.filename}: ${baseUrl ? new URL(attachment.url, baseUrl).toString() : attachment.url}`);
  return [
    `${payload.reporterName} <${payload.reporterEmail}> em ${when}:`,
    '',
    payload.message,
    ...(links.length > 0 ? ['', 'Anexos:', ...links] : []),
  ].join('\n');
}

/** Returns whether it actually sent — the caller uses this to decide whether to stamp `emailedAt`. */
export async function sendBugReportEmail(payload: BugReportEmailPayload): Promise<boolean> {
  const env = getEnv();
  if (!env.SMTP_URL) {
    console.log(`[bug-report] SMTP_URL vazio — relato de ${payload.reporterEmail} ficou só no app.`);
    return false;
  }

  try {
    const transport = nodemailer.createTransport(env.SMTP_URL);
    await transport.sendMail({
      // Gmail refuses a message whose sender isn't the account that logged in.
      from: env.MAIL_FROM ?? decodeURIComponent(new URL(env.SMTP_URL).username),
      to: BUG_REPORT_RECIPIENT,
      replyTo: `${payload.reporterName} <${payload.reporterEmail}>`,
      subject: `[Eve Hub] Bug/feedback de ${payload.reporterName}`,
      text: bugReportText(payload, env.PUBLIC_BASE_URL),
    });
    return true;
  } catch (error) {
    console.error('[bug-report] falha ao enviar o e-mail:', error);
    return false;
  }
}
