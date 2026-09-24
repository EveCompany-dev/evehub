import { errorMessage, loadConnectorContext } from './connector-context';
import { publishConnectorEvent } from './events';
import { Prisma, prisma } from './prisma';

/** How long the undo button stays available after an edit. */
export const UNDO_WINDOW_MS = 10 * 60 * 1000;

export type WriteOutcome =
  | { ok: true; editLogId: string; newVersion: string; data: Record<string, unknown> }
  | {
      ok: false;
      conflict: true;
      message: string;
      currentVersion: string | null;
      currentData: Record<string, unknown> | null;
    }
  | { ok: false; conflict?: false; message: string };

function toJsonInput(value: unknown): Prisma.InputJsonValue {
  return (value === undefined || value === null ? Prisma.JsonNull : value) as Prisma.InputJsonValue;
}

export interface WriteInput {
  instanceId: string;
  userId: string;
  remoteId: string;
  /** Top-level field of the record. Nested paths are not supported. */
  field: string;
  value: unknown;
  /** The `remoteVersion` the client had when it rendered the value it edited. */
  expectedVersion: string;
  /** Set when this write is itself the undo of another edit. */
  undoOf?: string;
}

/**
 * Writes one field of one record upstream, under an optimistic lock.
 *
 * The lock is enforced by the connector against the live source, not against
 * our cache — a cache-only check would happily overwrite a change made
 * directly in Notion five seconds ago.
 */
export async function performWrite(input: WriteInput): Promise<WriteOutcome> {
  const { instanceId, userId, remoteId, field, value, expectedVersion, undoOf } = input;

  const instance = await prisma.connectorInstance.findUnique({ where: { id: instanceId } });
  if (!instance) return { ok: false, message: 'Instância não encontrada.' };

  let loaded;
  try {
    loaded = loadConnectorContext(instance);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  const { connector, ctx } = loaded;
  if (!connector.capabilities.write || !connector.write) {
    return { ok: false, message: `O connector "${connector.id}" e somente leitura.` };
  }

  const record = await prisma.syncRecord.findUnique({
    where: { connectorInstanceId_remoteId: { connectorInstanceId: instanceId, remoteId } },
  });
  if (!record) return { ok: false, message: 'Registro não encontrado no cache local. Sincronize antes de editar.' };

  const previousData = (record.data ?? {}) as Record<string, unknown>;
  const oldValue = previousData[field];

  let result;
  try {
    result = await connector.write(ctx, { remoteId, patch: { [field]: value }, expectedVersion });
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  if (!result.ok && result.conflict) {
    // Refresh the local cache so a reload shows what is actually upstream.
    if (result.currentVersion) {
      await prisma.syncRecord.update({
        where: { id: record.id },
        data: {
          remoteVersion: result.currentVersion,
          data: toJsonInput(result.currentData ?? previousData),
          syncedAt: new Date(),
        },
      });
    }
    return {
      ok: false,
      conflict: true,
      message: 'Esse dado mudou na origem depois que você abriu a tela. Recarregue antes de salvar.',
      currentVersion: result.currentVersion,
      currentData: result.currentData,
    };
  }

  if (!result.ok) return { ok: false, message: result.error };

  const editLog = await prisma.$transaction(async (tx) => {
    await tx.syncRecord.update({
      where: { id: record.id },
      data: { remoteVersion: result.newVersion, data: toJsonInput(result.data), syncedAt: new Date() },
    });

    return tx.editLog.create({
      data: {
        workspaceId: instance.workspaceId,
        connectorInstanceId: instanceId,
        userId,
        remoteId,
        fieldPath: field,
        oldValue: toJsonInput(oldValue),
        newValue: toJsonInput(value),
        ...(undoOf ? { undoOf } : {}),
      },
    });
  });

  await publishConnectorEvent({
    type: 'connector:updated',
    workspaceId: instance.workspaceId,
    instanceId,
    connectorId: instance.connectorId,
    status: 'ok',
    syncedAt: new Date().toISOString(),
  });

  return { ok: true, editLogId: editLog.id, newVersion: result.newVersion, data: result.data };
}

/**
 * Reverts an edit through the very same write path.
 *
 * The subtle part: the stored `expectedVersion` from the original edit is
 * guaranteed to be stale (the edit itself bumped it), so undo re-reads the
 * live version first. There is deliberately no "force write" path — if
 * somebody else changed the record after you, your undo conflicts, which is
 * the correct answer.
 */
export async function performUndo(input: { editLogId: string; userId: string }): Promise<WriteOutcome> {
  const log = await prisma.editLog.findUnique({
    where: { id: input.editLogId },
    include: { connectorInstance: true },
  });

  if (!log) return { ok: false, message: 'Edição não encontrada.' };
  if (log.rolledBackAt) return { ok: false, message: 'Essa edição já foi desfeita.' };
  if (Date.now() - log.createdAt.getTime() > UNDO_WINDOW_MS) {
    return { ok: false, message: 'A janela de 10 minutos para desfazer ja passou.' };
  }

  let loaded;
  try {
    loaded = loadConnectorContext(log.connectorInstance);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  const { connector, ctx } = loaded;
  if (!connector.readVersion) {
    return { ok: false, message: `O connector "${connector.id}" não sabe reler a versão atual, então não dá para desfazer com segurança.` };
  }

  let currentVersion: string | null;
  try {
    currentVersion = await connector.readVersion(ctx, log.remoteId);
  } catch (error) {
    return { ok: false, message: errorMessage(error) };
  }

  if (!currentVersion) {
    return { ok: false, message: 'O registro não existe mais na origem.' };
  }

  const result = await performWrite({
    instanceId: log.connectorInstanceId,
    userId: input.userId,
    remoteId: log.remoteId,
    field: log.fieldPath,
    value: log.oldValue,
    expectedVersion: currentVersion,
    // Marca a entrada nova como "isto e um desfazer", para ela mesma nao
    // aparecer como desfazivel.
    undoOf: log.id,
  });

  if (result.ok) {
    await prisma.editLog.update({
      where: { id: log.id },
      data: { rolledBackAt: new Date(), rolledBackBy: result.editLogId },
    });
  }

  return result;
}

export interface UndoableEdit {
  id: string;
  remoteId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  createdAt: string;
  expiresAt: string;
  /** null quando a conta do autor foi apagada — ver EditLog.userLabel. */
  userId: string | null;
  userName: string | null;
}

/** Edits still inside the undo window, newest first. */
export async function listUndoableEdits(instanceId: string): Promise<UndoableEdit[]> {
  const since = new Date(Date.now() - UNDO_WINDOW_MS);

  const edits = await prisma.editLog.findMany({
    where: {
      connectorInstanceId: instanceId,
      rolledBackAt: null,
      createdAt: { gte: since },
      // Uma edicao de desfazer nao e, ela propria, desfazivel.
      undoOf: null,
    },
    orderBy: { createdAt: 'desc' },
    include: { user: { select: { name: true } } },
    take: 25,
  });

  return edits.map((edit) => ({
    id: edit.id,
    remoteId: edit.remoteId,
    field: edit.fieldPath,
    oldValue: edit.oldValue,
    newValue: edit.newValue,
    createdAt: edit.createdAt.toISOString(),
    expiresAt: new Date(edit.createdAt.getTime() + UNDO_WINDOW_MS).toISOString(),
    userId: edit.userId,
    // A conta pode ter sido apagada; o label gravado na exclusao e o que resta.
    userName: edit.user?.name ?? edit.userLabel,
  }));
}
