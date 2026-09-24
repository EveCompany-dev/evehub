import { errorMessage } from '@eve/core';
import { strings } from '@eve/ui';
import { NextResponse } from 'next/server';
import { HttpError } from './session';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wraps a route handler so an HttpError becomes its status and message (those
 * are written for the user), and anything else becomes a logged 500 with a
 * fixed message.
 *
 * The detail stays on the server deliberately. This used to return
 * `errorMessage(error)`, which stopped the stack trace but still shipped the
 * message — and a Prisma error message names the model, the field and the
 * constraint, while a validation error embeds a rendered copy of the query
 * including its arguments. Third-party errors (Meta, Anthropic) came through
 * verbatim too.
 */
export async function handle(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message);
    console.error('[api] unhandled error:', errorMessage(error), error);
    return fail(500, strings.errors.unexpected);
  }
}
