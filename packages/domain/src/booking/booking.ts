import type { Interval } from '../availability/intervals';

export type BookingStatus = 'CONFIRMED' | 'CANCELLED';

export interface Booking {
  readonly id: string;
  readonly eventTypeId: string;
  readonly hostId: string;
  readonly start: number;
  readonly end: number;
  readonly blocked: Interval;
  readonly status: BookingStatus;
}

export type BookingProblem = 'already_cancelled' | 'already_started';

export function cancellationProblem(booking: Pick<Booking, 'status' | 'start'>, now: number): BookingProblem | null {
  if (booking.status === 'CANCELLED') return 'already_cancelled';
  if (booking.start <= now) return 'already_started';
  return null;
}
