import { prisma } from '@eve/core';
import { handle, ok } from '../../../../../lib/api';
import { requireClient, visibleJobsWhere } from '../../../../../lib/jobs';
import { requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const LIMIT = 40;
/** A name shorter than this ("Eve") would match half the workspace's chat; skip the mention search. */
const MIN_NAME_FOR_MENTIONS = 3;

/**
 * Everything the rest of the app knows about a client, in one response for the
 * client page: its jobs (whether or not filed in a project), the files
 * attached to those jobs plus the media of its scheduled posts, and where the
 * client's name comes up in team chat and in other jobs' comments.
 *
 * Mentions are a text match on the name, not a stored link — chat and
 * comments are free text and only @user mentions are structured. Private
 * direct messages are deliberately never searched.
 */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    const client = await requireClient(id, user.workspaceId);

    const searchMentions = client.name.trim().length >= MIN_NAME_FOR_MENTIONS;
    const nameFilter = { contains: client.name.trim(), mode: 'insensitive' as const };

    const [jobs, attachments, posts, chat, comments] = await Promise.all([
      prisma.job.findMany({
        where: { ...visibleJobsWhere(user), clientId: id },
        orderBy: { updatedAt: 'desc' },
        take: 100,
        select: {
          id: true,
          title: true,
          dueDate: true,
          important: true,
          column: { select: { name: true } },
          project: { select: { title: true } },
          tasks: { select: { done: true } },
        },
      }),
      prisma.attachment.findMany({
        where: { task: { job: { ...visibleJobsWhere(user), clientId: id } } },
        orderBy: { createdAt: 'desc' },
        take: LIMIT,
        select: { id: true, filename: true, url: true, size: true, createdAt: true, task: { select: { title: true, job: { select: { id: true, title: true } } } } },
      }),
      prisma.scheduledPost.findMany({
        where: { clientId: id },
        orderBy: { scheduledFor: 'desc' },
        take: LIMIT,
        select: { id: true, mediaUrl: true, caption: true, platform: true, scheduledFor: true },
      }),
      searchMentions
        ? prisma.teamMessage.findMany({
            where: { workspaceId: user.workspaceId, body: nameFilter },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, body: true, createdAt: true, author: { select: { name: true, email: true } } },
          })
        : Promise.resolve([]),
      searchMentions
        ? prisma.jobComment.findMany({
            // Comments on this client's own jobs are already under "Jobs"; the interesting ones are elsewhere.
            where: { body: nameFilter, job: { ...visibleJobsWhere(user), NOT: { clientId: id } } },
            orderBy: { createdAt: 'desc' },
            take: LIMIT,
            select: { id: true, body: true, createdAt: true, job: { select: { id: true, title: true } }, author: { select: { name: true, email: true } } },
          })
        : Promise.resolve([]),
    ]);

    const person = (author: { name: string | null; email: string }) => author.name ?? author.email.split('@')[0]!;

    return ok({
      jobs: jobs.map((job) => ({
        id: job.id,
        title: job.title,
        dueDate: job.dueDate,
        important: job.important,
        columnName: job.column.name,
        projectTitle: job.project?.title ?? null,
        tasksDone: job.tasks.filter((task) => task.done).length,
        tasksTotal: job.tasks.length,
      })),
      files: [
        ...attachments.map((file) => ({
          id: `att-${file.id}`,
          name: file.filename,
          url: file.url,
          size: file.size,
          createdAt: file.createdAt,
          origin: `Job: ${file.task.job.title}`,
          jobId: file.task.job.id,
        })),
        ...posts
          .filter((post) => post.mediaUrl)
          .map((post) => ({
            id: `post-${post.id}`,
            name: post.mediaUrl.split('/').pop() ?? 'mídia',
            url: post.mediaUrl,
            size: null,
            createdAt: post.scheduledFor,
            origin: `Post agendado (${post.platform})`,
            jobId: null,
          })),
      ],
      mentions: [
        ...chat.map((message) => ({
          id: `chat-${message.id}`,
          source: 'chat' as const,
          where: 'Chat da equipe',
          href: '/chat',
          author: person(message.author),
          body: message.body,
          createdAt: message.createdAt,
        })),
        ...comments.map((comment) => ({
          id: `comment-${comment.id}`,
          source: 'comment' as const,
          where: `Comentário em “${comment.job.title}”`,
          href: `/jobs?job=${comment.job.id}`,
          author: person(comment.author),
          body: comment.body,
          createdAt: comment.createdAt,
        })),
      ]
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
        .slice(0, LIMIT),
    });
  });
}
