import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  LoggerService,
} from '@nestjs/common';
import { Request, Response } from 'express';
import { DomainError, RateLimitedError } from '../errors/domain-error';
import { requestContext } from '../logging/request-context';

interface ProblemDocument {
  type: string;
  title: string;
  status: number;
  code: string;
  detail: string;
  instance: string;
  requestId?: string;
  errors?: unknown;
  [key: string]: unknown;
}

/**
 * Serializes every failure as an RFC 9457 problem document. A single response shape means clients
 * write one error handler, and `code` stays stable even when the prose changes.
 */
@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  constructor(private readonly logger: LoggerService) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();
    const problem = this.toProblem(exception, request);

    if (problem.status >= HttpStatus.INTERNAL_SERVER_ERROR)
      this.logger.error({
        message: 'request.failed',
        path: request.path,
        error: (exception as Error)?.message,
        stack: (exception as Error)?.stack,
      });

    if (exception instanceof RateLimitedError)
      response.setHeader('Retry-After', String(exception.retryAfterSeconds));

    response.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, request: Request): ProblemDocument {
    const requestId = requestContext.current()?.requestId;
    const base = { instance: request.originalUrl, requestId };

    if (exception instanceof DomainError)
      return {
        ...base,
        type: `https://hookline.dev/problems/${exception.code}`,
        title: titleFor(exception.status),
        status: exception.status,
        code: exception.code,
        detail: exception.message,
        ...(exception.details ? { errors: exception.details } : {}),
      };

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const body = exception.getResponse();
      const detail =
        typeof body === 'string'
          ? body
          : ((body as { message?: string | string[] }).message ?? exception.message);
      return {
        ...base,
        type: `https://hookline.dev/problems/${codeFor(status)}`,
        title: titleFor(status),
        status,
        code: codeFor(status),
        detail: Array.isArray(detail) ? detail.join('; ') : detail,
        ...(Array.isArray(detail) ? { errors: detail } : {}),
      };
    }

    return {
      ...base,
      type: 'https://hookline.dev/problems/internal_error',
      title: titleFor(HttpStatus.INTERNAL_SERVER_ERROR),
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      code: 'internal_error',
      detail: 'The request could not be completed.',
    };
  }
}

function codeFor(status: number): string {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
      return 'invalid_request';
    case HttpStatus.UNAUTHORIZED:
      return 'unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'forbidden';
    case HttpStatus.NOT_FOUND:
      return 'not_found';
    case HttpStatus.CONFLICT:
      return 'conflict';
    case HttpStatus.PAYLOAD_TOO_LARGE:
      return 'payload_too_large';
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return 'invalid_request';
    case HttpStatus.TOO_MANY_REQUESTS:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal_error' : 'request_failed';
  }
}

function titleFor(status: number): string {
  return status >= 500 ? 'Server error' : 'Request rejected';
}
