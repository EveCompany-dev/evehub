import Anthropic from '@anthropic-ai/sdk';
import { getChatStore, MAX_MESSAGES, type ChatMessage } from '@eve/connector-chat';
import { errorMessage, getEnv } from '@eve/core';
import { strings } from '@eve/ui';
import { z } from 'zod';
import { fail, handle, ok } from '../../../../../lib/api';
import { getChatTools, runChatTool } from '../../../../../lib/chat-tools';
import { requireInstance, requireUser } from '../../../../../lib/session';

export const runtime = 'nodejs';

const sendSchema = z.object({ message: z.string().min(1).max(4000) });

// Guards against a pathological tool-call loop — five round trips is already
// generous for "look something up, then answer".
const MAX_TOOL_ROUNDS = 5;

/** History for this chat widget instance. */
export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireInstance(id, user);

    const messages = await getChatStore().load(id);
    return ok({ messages });
  });
}

/** Clears this widget's conversation history. */
export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireInstance(id, user);

    await getChatStore().save(id, []);
    return ok({ messages: [] });
  });
}

/**
 * Sends one message and returns the updated history including Claude's reply.
 *
 * Deliberately not streamed this round (see the widget for why) — a plain
 * request/response, non-streaming call, `effort: 'low'` since casual chat is
 * exactly the workload that doesn't need deep reasoning.
 */
export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  return handle(async () => {
    const user = await requireUser();
    const { id } = await context.params;
    await requireInstance(id, user);

    const body = sendSchema.safeParse(await request.json());
    if (!body.success) return fail(400, strings.errors.invalidPayload);

    const env = getEnv();
    if (!env.ANTHROPIC_API_KEY) return fail(400, strings.chat.notConfigured);

    const store = getChatStore();
    const history = await store.load(id);

    const userMessage: ChatMessage = {
      role: 'user',
      content: body.data.message,
      createdAt: new Date().toISOString(),
    };
    const withUser = [...history, userMessage].slice(-MAX_MESSAGES);

    const client = new Anthropic({ apiKey: env.ANTHROPIC_API_KEY });
    const tools = getChatTools(user);

    // Tool calls are resolved entirely within this one request — only the
    // final text reply gets persisted to history, matching ChatMessage's
    // existing plain-string shape rather than widening it to store every
    // intermediate tool_use/tool_result block.
    let messages: Anthropic.MessageParam[] = withUser.map((entry) => ({ role: entry.role, content: entry.content }));
    let replyText = '';

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const response = await client.messages.create({
          model: 'claude-opus-5',
          max_tokens: 4096,
          output_config: { effort: 'low' },
          tools,
          messages,
        });

        if (response.stop_reason !== 'tool_use') {
          const textBlock = response.content.find((block): block is Anthropic.TextBlock => block.type === 'text');
          replyText = textBlock?.text ?? '';
          break;
        }

        messages = [...messages, { role: 'assistant', content: response.content }];

        const toolResults: Anthropic.ToolResultBlockParam[] = [];
        for (const block of response.content) {
          if (block.type === 'tool_use') {
            const result = await runChatTool(user, block.name, block.input as Record<string, unknown>);
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: JSON.stringify(result) });
          }
        }
        messages = [...messages, { role: 'user', content: toolResults }];
      }
    } catch (error) {
      if (error instanceof Anthropic.APIError) return fail(502, error.message);
      return fail(502, errorMessage(error));
    }

    const assistantMessage: ChatMessage = {
      role: 'assistant',
      content: replyText,
      createdAt: new Date().toISOString(),
    };
    const updated = [...withUser, assistantMessage].slice(-MAX_MESSAGES);
    await store.save(id, updated);

    return ok({ messages: updated });
  });
}
