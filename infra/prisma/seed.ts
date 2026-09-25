import './load-env';
import { appendWidget, hashPassword, isAdminEmail, parseDashboardConfig, prisma } from '@eve/core';

/** The value shipped in .env.example; a seed must never set it as a real password. */
const PLACEHOLDER_PASSWORD = 'troque-esta-senha';
const MIN_PASSWORD_LENGTH = 12;

/**
 * Idempotent. Running it twice leaves the database in the same state, so it is
 * safe to re-run after every migration.
 */
async function main(): Promise<void> {
  const ownerEmail = process.env.SEED_OWNER_EMAIL;
  const ownerPassword = process.env.SEED_OWNER_PASSWORD;
  const workspaceName = process.env.SEED_WORKSPACE_NAME ?? 'EveCompany';

  if (!ownerEmail) throw new Error('SEED_OWNER_EMAIL nao definido. Preencha o .env antes de rodar o seed.');
  // Sem senha e valido (o owner entra so pelo Google). Com senha, nunca a do
  // exemplo nem uma curta: o seed roda no servidor de producao tambem.
  if (ownerPassword !== undefined && ownerPassword !== '') {
    if (ownerPassword === PLACEHOLDER_PASSWORD) {
      throw new Error('SEED_OWNER_PASSWORD ainda e a senha de exemplo do .env.example. Troque por uma senha propria (12+ caracteres) ou deixe vazio para entrar so pelo Google.');
    }
    if (ownerPassword.length < MIN_PASSWORD_LENGTH) {
      throw new Error(`SEED_OWNER_PASSWORD precisa ter pelo menos ${MIN_PASSWORD_LENGTH} caracteres.`);
    }
  }

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
      // Admin is a fixed list (packages/core/src/admins.ts), not whoever seeds.
      isOwner: isAdminEmail(ownerEmail),
      ...(passwordHash ? { passwordHash } : {}),
    },
    // Never silently reset an existing password on re-seed.
    update: { isOwner: isAdminEmail(ownerEmail) },
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
