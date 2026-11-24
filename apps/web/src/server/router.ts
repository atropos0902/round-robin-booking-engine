import { BookingService, SlotService, bookCommand, db, weekQuery } from '@rr/core';
import { z } from 'zod';
import { open, router, support } from './trpc';

const slots = new SlotService(db());
const bookings = new BookingService(db());
const token = z.object({ token: z.uuid() });

export const appRouter = router({
  links: open.query(() => slots.links()),
  week: open.input(weekQuery).query(({ input }) => slots.week(input.slug, input.startDate, input.timeZone)),
  book: open
    .input(bookCommand.required({ idempotencyKey: true }))
    .mutation(({ input }) => bookings.book(input)),
  booking: open.input(token).query(({ input }) => bookings.viewByToken(input.token)),
  cancel: open.input(token).mutation(({ input }) => bookings.cancel({ manageToken: input.token })),
  explain: support.input(z.object({ bookingId: z.uuid() })).mutation(({ input }) => bookings.explain(input.bookingId)),
});

export type AppRouter = typeof appRouter;
