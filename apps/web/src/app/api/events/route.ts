import { addConnectorListener } from '../../../lib/event-bus';
import { getSessionUser } from '../../../lib/session';

// Must be the Node runtime: the edge runtime has no Redis socket.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HEARTBEAT_MS = 25_000;

/**
 * Server-Sent Events stream of connector updates for the caller's workspace.
 *
 * SSE rather than WebSocket: the traffic is one-directional and tiny, it
 * survives proxies without an upgrade handshake, and the browser reconnects on
 * its own. Swapping it for Socket.io later touches no connector.
 */
export async function GET(request: Request): Promise<Response> {
  const user = await getSessionUser();
  if (!user) return new Response('Unauthorized', { status: 401 });

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const send = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          closed = true;
        }
      };

      send(': conectado\n\n');

      // Keeps intermediaries from dropping an idle connection.
      const heartbeat = setInterval(() => send(': ping\n\n'), HEARTBEAT_MS);

      const removeListener = addConnectorListener((event) => {
        if (event.workspaceId !== user.workspaceId) return;
        send(`event: connector\ndata: ${JSON.stringify(event)}\n\n`);
      });

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(heartbeat);
        removeListener();
        try {
          controller.close();
        } catch {
          // Already closed by the client.
        }
      };

      request.signal.addEventListener('abort', cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      // Stops nginx from buffering the stream into uselessness.
      'X-Accel-Buffering': 'no',
    },
  });
}
