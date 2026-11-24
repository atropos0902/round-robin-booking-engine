import { createHash, timingSafeEqual } from 'node:crypto';
import {
  type ArgumentsHost,
  type CallHandler,
  type CanActivate,
  Catch,
  type ExceptionFilter,
  type ExecutionContext,
  HttpException,
  Injectable,
  type NestInterceptor,
  type PipeTransform,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import * as Sentry from '@sentry/nestjs';
import { AppError, HTTP_STATUS, logger } from '@rr/core';
import type { Request, Response } from 'express';
import { Observable } from 'rxjs';
import type { ZodType } from 'zod';

export class ZodPipe<T> implements PipeTransform<unknown, T> {
  constructor(private readonly schema: ZodType<T>) {}

  transform(value: unknown): T {
    const result = this.schema.safeParse(value);
    if (result.success) return result.data;
    throw new UnprocessableEntityException({
      error: 'invalid_request',
      issues: result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    });
  }
}

const digest = (s: string) => createHash('sha256').update(s).digest();

@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const header = context.switchToHttp().getRequest<Request>().headers.authorization ?? '';
    const given = digest(header.replace(/^Bearer /, ''));
    const keys = (process.env.API_KEYS ?? '').split(',').map((k) => k.trim()).filter(Boolean);
    // Hashing first gives both sides one length, and every key is compared.
    const ok = keys.filter((k) => timingSafeEqual(digest(k), given)).length > 0;
    if (!ok) throw new UnauthorizedException({ error: 'unauthorized' });
    return true;
  }
}

@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(error: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof AppError) {
      response.status(HTTP_STATUS[error.code]).json({ error: error.code, message: error.message });
      return;
    }
    if (error instanceof HttpException) {
      response.status(error.getStatus()).json(error.getResponse());
      return;
    }
    logger.error({ err: error }, 'request failed');
    Sentry.captureException(error);
    response.status(500).json({ error: 'internal' });
  }
}

@Injectable()
export class RequestLog implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const { method, route } = context.switchToHttp().getRequest<Request & { route: { path: string } }>();
    const started = Date.now();
    return new Observable((subscriber) =>
      next.handle().subscribe({
        next: (v) => subscriber.next(v),
        error: (e) => {
          logger.warn({ method, route: route.path, ms: Date.now() - started }, 'request refused');
          subscriber.error(e);
        },
        complete: () => {
          logger.info({ method, route: route.path, ms: Date.now() - started }, 'request done');
          subscriber.complete();
        },
      }),
    );
  }
}
