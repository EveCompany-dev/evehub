import { prisma } from '@eve/core';
import { z } from 'zod';
import { fail, handle, ok } from '../../../lib/api';
import { sendBugReportEmail } from '../../../lib/bug-report-email';
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

    const sent = await sendBugReportEmail({
      reporterName: user.name?.trim() || user.email,
      reporterEmail: user.email,
      message: report.message,
      attachments: report.attachments.map((attachment) => ({ filename: attachment.filename, url: attachment.url })),
      createdAt: report.createdAt,
    });
    if (sent) await prisma.bugReport.update({ where: { id: report.id }, data: { emailedAt: new Date() } });

    return ok({ ok: true }, 201);
  });
}
