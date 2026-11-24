import type { IncomingMessage, ServerResponse } from 'node:http';
import { createApp } from './create-app';

type Listener = (req: IncomingMessage, res: ServerResponse) => void;

let starting: Promise<Listener> | undefined;

/** Nest starts once per instance. A failed start is forgotten, so the next request tries again. */
function listener(): Promise<Listener> {
  starting ??= createApp()
    .then(async (app) => {
      await app.init();
      return app.getHttpAdapter().getInstance() as Listener;
    })
    .catch((error) => {
      starting = undefined;
      throw error;
    });
  return starting;
}

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  (await listener())(req, res);
}
