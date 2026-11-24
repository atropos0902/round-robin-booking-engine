import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import * as Sentry from '@sentry/nextjs';
import { TRPCError, initTRPC } from '@trpc/server';
import type { CreateNextContextOptions } from '@trpc/server/adapters/next';
import { AppError, type ErrorCode, logger, runWithContext } from '@rr/core';

export function createContext({ req }: CreateNextContextOptions) {
  return { supportKey: req.headers['x-support-key'], requestId: randomUUID() };
}

const TRPC_CODE: Record<ErrorCode, TRPCError['code']> = {
  not_found: 'NOT_FOUND',
  invalid_slot: 'UNPROCESSABLE_CONTENT',
  no_host_available: 'CONFLICT',
  already_cancelled: 'CONFLICT',
  already_started: 'CONFLICT',
  idempotency_mismatch: 'UNPROCESSABLE_CONTENT',
};

const t = initTRPC.context<ReturnType<typeof createContext>>().create({
  errorFormatter({ shape, error }) {
    const known = error.cause instanceof AppError;
    const ours = error.code !== 'INTERNAL_SERVER_ERROR';
    return {
      ...shape,
      message: ours ? shape.message : 'Something went wrong on our side',
      data: { code: shape.data.code, httpStatus: shape.data.httpStatus, reason: known ? (error.cause as AppError).code : null },
    };
  },
});

const observed = t.middleware(async ({ ctx, path, next }) =>
  Sentry.withIsolationScope(() =>
    runWithContext({ requestId: ctx.requestId }, async () => {
      const started = Date.now();
      const result = await next();
      const ms = Date.now() - started;
      if (result.ok) {
        logger.info({ path, ms }, 'call done');
        return result;
      }
      const cause = result.error.cause;
      if (cause instanceof AppError) {
        logger.info({ path, ms, code: cause.code }, 'call refused');
        throw new TRPCError({ code: TRPC_CODE[cause.code], message: cause.message, cause });
      }
      if (result.error.code === 'INTERNAL_SERVER_ERROR') {
        logger.error({ path, ms, err: cause ?? result.error }, 'call failed');
        Sentry.captureException(cause ?? result.error);
      }
      return result;
    }),
  ),
);

const digest = (s: string) => createHash('sha256').update(s).digest();

const supportOnly = t.middleware(({ ctx, next }) => {
  const key = process.env.SUPPORT_KEY;
  const given = ctx.supportKey;
  if (!key || typeof given !== 'string' || !timingSafeEqual(digest(key), digest(given))) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'That support key is not right' });
  }
  return next();
});

export const router = t.router;
export const open = t.procedure.use(observed);
export const support = open.use(supportOnly);
