import { prisma } from '@eve/core';
import { z } from 'zod';
import { logActivity, quoted } from '../../../lib/activity';
import { fail, handle, ok } from '../../../lib/api';
import { BUG_REPORT_RECIPIENT, sendBugReportEmail } from '../../../lib/bug-report-email';
import { notify } from '../../../lib/notifications';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

const attachmentSchema = z.object({
  filename: z.string().min(1).max(200),
  url: z.string().min(1).max(2000),
  size: z.number().int().nonnegative(),
});

const createSchema = z.object({
  message: z.string().trim().min(1).max(4000),
  attachments: z.array(attachmentSchema).max(10).default([]),
});

/** Anyone authenticated can file one — there's no tab/permission gate on reporting a bug. */
export async function POST(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const body = createSchema.safeParse(await request.json());
    if (!body.success) return fail(400, body.error.issues.map((issue) => issue.message).join('; '));

    const report = await prisma.bugReport.create({
      data: {
        workspaceId: user.workspaceId,
        reporterId: user.id,
        message: body.data.message,
        attachments: { create: body.data.attachments },
      },
      include: { attachments: true },
    });

    // In jose@'s bell right away — the e-mail below only goes out once SMTP is set up.
    const recipient = await prisma.user.findFirst({
      where: { workspaceId: user.workspaceId, email: BUG_REPORT_RECIPIENT, deletedAt: null },
      select: { id: true },
    });
    if (recipient) {
      await notify({
        workspaceId: user.workspaceId,
        userId: recipient.id,
        actorId: user.id,
        type: 'bugReport',
        message: `${user.name?.trim() || user.email} relatou: ${report.message.slice(0, 200)}${report.message.length > 200 ? '…' : ''}`,
      });
    }

    const sent = await sendBugReportEmail({
      reporterName: user.name?.trim() || user.email,
      reporterEmail: user.email,
      message: report.message,
      attachments: report.attachments.map((attachment) => ({ filename: attachment.filename, url: attachment.url })),
      createdAt: report.createdAt,
    });
    if (sent) await prisma.bugReport.update({ where: { id: report.id }, data: { emailedAt: new Date() } });

    await logActivity(user, {
      action: 'bug.report',
      // Long enough to read the report where the bell sends jose@ (the activity log).
      summary: `enviou um relato de bug/feedback: ${quoted(report.message, 600)}${report.attachments.length > 0 ? ` (${report.attachments.length} anexo${report.attachments.length === 1 ? '' : 's'})` : ''}`,
      entityType: 'bugReport',
      entityId: report.id,
    });

    return ok({ ok: true }, 201);
  });
}
