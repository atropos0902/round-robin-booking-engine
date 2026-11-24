import { Module } from '@nestjs/common';
import { APP_FILTER, APP_INTERCEPTOR } from '@nestjs/core';
import { BookingService, BusyService, SlotService, db } from '@rr/core';
import { BookingsController } from './bookings.controller';
import { HealthController } from './health.controller';
import { ErrorFilter, RequestLog } from './http';

@Module({
  controllers: [BookingsController, HealthController],
  providers: [
    { provide: BookingService, useFactory: () => new BookingService(db()) },
    { provide: SlotService, useFactory: () => new SlotService(db()) },
    { provide: BusyService, useFactory: () => new BusyService(db()) },
    { provide: APP_FILTER, useClass: ErrorFilter },
    { provide: APP_INTERCEPTOR, useClass: RequestLog },
  ],
})
export class AppModule {}
