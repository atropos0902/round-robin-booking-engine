import { logger } from '@rr/core';
import { createApp } from './create-app';

async function main(): Promise<void> {
  const app = await createApp();
  app.enableShutdownHooks();
  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port);
  logger.info({ port }, 'api is listening');
}

void main();
