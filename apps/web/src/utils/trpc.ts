import { httpBatchLink } from '@trpc/client';
import { createTRPCNext } from '@trpc/next';
import type { inferRouterOutputs } from '@trpc/server';
import type { AppRouter } from '../server/router';

export const supportKey = { current: '' };

export const trpc = createTRPCNext<AppRouter>({
  config: () => ({
    links: [
      httpBatchLink({
        url: '/api/trpc',
        headers: () => (supportKey.current ? { 'x-support-key': supportKey.current } : {}),
      }),
    ],
    queryClientConfig: { defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false } } },
  }),
  ssr: false,
});

export type Outputs = inferRouterOutputs<AppRouter>;
