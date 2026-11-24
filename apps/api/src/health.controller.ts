import { Controller, Get } from '@nestjs/common';
import { db, outboxStatus, release } from '@rr/core';

@Controller('healthz')
export class HealthController {
  @Get()
  async health() {
    const { pending, oldestSeconds } = await outboxStatus(db());
    return { ok: true, release, outbox: { pending, oldestSeconds } };
  }
}
