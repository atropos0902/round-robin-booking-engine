import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  type BookCommand,
  BookingService,
  BusyService,
  SlotService,
  bookCommand,
  busyCommand,
  slotsQuery,
} from '@rr/core';
import type { z } from 'zod';
import { ApiKeyGuard, ZodPipe } from './http';

@Controller('v1')
@UseGuards(ApiKeyGuard)
export class BookingsController {
  constructor(
    @Inject(BookingService) private readonly bookings: BookingService,
    @Inject(SlotService) private readonly slots: SlotService,
    @Inject(BusyService) private readonly busy: BusyService,
  ) {}

  @Get('event-types')
  links() {
    return this.slots.links();
  }

  @Get('slots')
  open(@Query(new ZodPipe(slotsQuery)) query: z.output<typeof slotsQuery>) {
    return this.slots.open(query.slug, query.from, query.to);
  }

  @Post('bookings')
  book(@Body(new ZodPipe(bookCommand)) command: BookCommand, @Headers('idempotency-key') key?: string) {
    // A client that times out has to be able to ask again without getting a second meeting.
    const idempotencyKey = key ?? command.idempotencyKey;
    if (!idempotencyKey || idempotencyKey.length < 8 || idempotencyKey.length > 128) {
      throw new BadRequestException({ error: 'idempotency_key_required' });
    }
    return this.bookings.book({ ...command, idempotencyKey });
  }

  @Get('bookings/:id')
  view(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.view(id);
  }

  @Get('bookings/:id/assignment')
  assignment(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.explain(id);
  }

  @Delete('bookings/:id')
  @HttpCode(200)
  cancel(@Param('id', ParseUUIDPipe) id: string) {
    return this.bookings.cancel({ id });
  }

  @Put('hosts/:hostId/busy')
  replaceBusy(
    @Param('hostId', ParseUUIDPipe) hostId: string,
    @Body(new ZodPipe(busyCommand)) command: z.output<typeof busyCommand>,
  ) {
    return this.busy.replace(hostId, command);
  }
}
