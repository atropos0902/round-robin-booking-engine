import type { z } from 'zod';
import type { busyCommand } from '../contracts';
import type { Db } from '../db';
import { AppError } from '../errors';

export class BusyService {
  constructor(private readonly db: Db) {}

  /** Replaces what one calendar said about a host inside a range. Sending it twice changes nothing. */
  async replace(hostId: string, command: z.output<typeof busyCommand>): Promise<{ blocks: number }> {
    const { source, from, to, blocks } = command;
    if (!(await this.db.host.findUnique({ where: { id: hostId } }))) throw new AppError('not_found', 'There is no such host');
    await this.db.$transaction([
      this.db.busyBlock.deleteMany({ where: { hostId, source, from: { gte: from, lt: to } } }),
      this.db.busyBlock.createMany({ data: blocks.map((b) => ({ hostId, source, ...b })) }),
    ]);
    return { blocks: blocks.length };
  }
}
