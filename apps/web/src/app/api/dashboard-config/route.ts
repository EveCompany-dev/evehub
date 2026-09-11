import { dashboardConfigSchema, parseDashboardConfig, prisma } from '@eve/core';
import { strings } from '@eve/ui';
import { fail, handle, ok } from '../../../lib/api';
import { requireUser } from '../../../lib/session';

export const runtime = 'nodejs';

export async function GET(): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const row = await prisma.user.findUnique({ where: { id: user.id }, select: { dashboardConfig: true } });
    return ok({ config: parseDashboardConfig(row?.dashboardConfig) });
  });
}

/** Persists the grid layout, theme and per-widget settings for this user only. */
export async function PUT(request: Request): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();

    const parsed = dashboardConfigSchema.safeParse(await request.json());
    if (!parsed.success) return fail(400, strings.errors.invalidPayload);

    await prisma.user.update({
      where: { id: user.id },
      data: { dashboardConfig: parsed.data },
    });

    return ok({ config: parsed.data });
  });
}
