import { Prisma, PrismaClient } from '@prisma/client';

export type Db = PrismaClient;
export type Tx = Prisma.TransactionClient;

const holder = globalThis as unknown as { rrPrisma?: PrismaClient };

/** One client per process. Warm functions reuse it, and so does hot reload. */
export function db(): PrismaClient {
  return (holder.rrPrisma ??= new PrismaClient());
}

/** The Postgres error code behind a Prisma error, if there is one. */
export function sqlState(error: unknown): string | null {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return '23505';
    const code = (error.meta as { code?: unknown } | undefined)?.code;
    return typeof code === 'string' ? code : null;
  }
  // Prisma has no code of its own for an exclusion violation and only passes the text on.
  if (error instanceof Prisma.PrismaClientUnknownRequestError) {
    return /code: "([0-9A-Z]{5})"/.exec(error.message)?.[1] ?? null;
  }
  return null;
}
