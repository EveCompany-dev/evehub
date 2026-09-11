import { errorMessage } from '@eve/core';
import { NextResponse } from 'next/server';
import { HttpError } from './session';

export function ok<T>(data: T, status = 200): NextResponse {
  return NextResponse.json(data, { status });
}

export function fail(status: number, message: string): NextResponse {
  return NextResponse.json({ error: message }, { status });
}

/**
 * Wraps a route handler so an HttpError becomes its status and anything else
 * becomes a logged 500 — instead of a stack trace leaking to the browser.
 */
export async function handle(run: () => Promise<NextResponse>): Promise<NextResponse> {
  try {
    return await run();
  } catch (error) {
    if (error instanceof HttpError) return fail(error.status, error.message);
    console.error('[api] unhandled error:', error);
    return fail(500, errorMessage(error));
  }
}
