export type ErrorCode =
  | 'not_found'
  | 'invalid_slot'
  | 'no_host_available'
  | 'already_cancelled'
  | 'already_started'
  | 'idempotency_mismatch';

/** Something the caller can act on. Everything else is a bug or an outage. */
export class AppError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const HTTP_STATUS: Record<ErrorCode, number> = {
  not_found: 404,
  invalid_slot: 422,
  no_host_available: 409,
  already_cancelled: 409,
  already_started: 409,
  idempotency_mismatch: 422,
};
