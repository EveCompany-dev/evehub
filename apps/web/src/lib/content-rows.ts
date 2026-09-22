import { mediaKindFromUrl, targetLabel, type PostTarget } from '@eve/connector-meta/shared';
import { prisma, refreshContentRow, type Prisma } from '@eve/core';
import { contentFieldsFor, contentTitleFrom } from './content-targets';
import { ensureSystemTable } from './system-tables';

/**
 * Server half of "a post is its Calendário de Conteúdo row": finding the row
 * a post was scheduled from, and creating one for a post written straight in
 * Agendar Post, so every post shows up on its client's calendar.
 */

/** A row of this workspace's Calendário de Conteúdo, or null. */
export async function findContentRow(workspaceId: string, rowId: string): Promise<{ id: string; data: Record<string, unknown> } | null> {
  const row = await prisma.dataTableRow.findFirst({ where: { id: rowId, table: { workspaceId, kind: 'content' } }, select: { id: true, data: true } });
  if (!row) return null;
  const data = row.data && typeof row.data === 'object' && !Array.isArray(row.data) ? (row.data as Record<string, unknown>) : {};
  return { id: row.id, data };
}

export interface LinkPostsInput {
  workspaceId: string;
  /** The row the post was scheduled from; omit to create one. */
  rowId?: string;
  postIds: string[];
  client: { id: string; label: string };
  target: PostTarget;
  carousel: boolean;
  caption: string;
  mediaUrl: string;
}

/**
 * Ties freshly created posts to their row, filling in what the row lacks
 * (an image, for one), then lets refreshContentRow set Status and date.
 * Returns the row id.
 */
export async function linkPostsToContent(input: LinkPostsInput): Promise<string> {
  const image = mediaKindFromUrl(input.mediaUrl) === 'image' ? input.mediaUrl : null;
  let rowId = input.rowId;

  if (rowId) {
    const row = await findContentRow(input.workspaceId, rowId);
    if (row && image && (typeof row.data.imagem !== 'string' || row.data.imagem === '')) {
      await prisma.dataTableRow.update({ where: { id: row.id }, data: { data: { ...row.data, imagem: image } as Prisma.InputJsonValue } });
    }
  } else {
    const table = await ensureSystemTable(input.workspaceId, 'content');
    const { canal, formato } = contentFieldsFor(input.target, input.carousel);
    const row = await prisma.dataTableRow.create({
      data: {
        tableId: table.id,
        data: {
          titulo: contentTitleFrom(input.caption, `${targetLabel(input.target)} de ${input.client.label}`),
          cliente: input.client.id,
          canal,
          formato,
          texto: input.caption,
          ...(image ? { imagem: image } : {}),
        },
      },
      select: { id: true },
    });
    rowId = row.id;
  }

  await prisma.scheduledPost.updateMany({ where: { id: { in: input.postIds }, workspaceId: input.workspaceId }, data: { contentRowId: rowId } });
  await refreshContentRow(rowId);
  return rowId;
}
