import './load-env';
import { appendWidget, hashPassword, parseDashboardConfig, prisma } from '@eve/core';

/**
 * Idempotent. Running it twice leaves the database in the same state, so it is
 * safe to re-run after every migration.
 */
async function main(): Promise<void> {
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const workspaceName = process.env.SEED_WORKSPACE_NAME ?? 'EveCompany';

  if (!ownerEmail) throw new Error('SEED_OWNER_EMAIL nao definido. Preencha o .env antes de rodar o seed.');

  const workspace =
    (await prisma.workspace.findFirst({ where: { name: workspaceName } })) ??
    (await prisma.workspace.create({ data: { name: workspaceName } }));

  console.log(`workspace: ${workspace.name} (${workspace.id})`);

  const passwordHash = ownerPassword ? await hashPassword(ownerPassword) : undefined;

  const owner = await prisma.user.upsert({
    where: { email: ownerEmail },
    create: {
      email: ownerEmail,
      name: ownerEmail.split('@')[0] ?? 'Owner',
      workspaceId: workspace.id,
      isOwner: true,
      ...(passwordHash ? { passwordHash } : {}),
    },
    // Never silently reset an existing password on re-seed.
    update: { isOwner: true },
  });

  console.log(`owner: ${owner.email} (isOwner=${owner.isOwner}, senha=${owner.passwordHash ? 'definida' : 'so Google'})`);

  // A demo instance so a fresh clone shows a working dashboard immediately,
  // before anyone has configured a real integration.
  let demo = await prisma.connectorInstance.findFirst({
    where: { workspaceId: workspace.id, connectorId: 'demo' },
  });

  if (!demo) {
    demo = await prisma.connectorInstance.create({
      data: {
        workspaceId: workspace.id,
        connectorId: 'demo',
        label: 'Clientes (demo)',
        config: { clientCount: 6, seed: 'evecompany' },
      },
    });
    console.log(`connector instance: ${demo.label} (${demo.id})`);
  }

  const config = parseDashboardConfig(owner.dashboardConfig);
  if (!config.layout.some((item) => item.i === demo.id)) {
    const next = appendWidget(config, demo.id, { w: 7, h: 8 });
    await prisma.user.update({ where: { id: owner.id }, data: { dashboardConfig: next } });
    console.log('widget de demo adicionado ao dashboard do owner');
  }

  console.log('seed concluido.');
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
