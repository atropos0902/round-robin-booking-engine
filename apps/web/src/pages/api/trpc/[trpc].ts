import { createNextApiHandler } from '@trpc/server/adapters/next';
import { waitUntil } from '@vercel/functions';
import type { NextApiRequest, NextApiResponse } from 'next';
import { flushLogs } from '@rr/core';
import { appRouter } from '../../../server/router';
import { createContext } from '../../../server/trpc';

const trpc = createNextApiHandler({ router: appRouter, createContext });

export default async function handler(req: NextApiRequest, res: NextApiResponse): Promise<void> {
  res.setHeader('Cache-Control', 'no-store');
  await trpc(req, res);
  waitUntil(flushLogs());
}
