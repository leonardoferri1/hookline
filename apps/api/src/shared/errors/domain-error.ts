/**
 * Errors raised by the application layer. Each one carries the HTTP status and a stable error
 * code, so transport concerns stay in the exception filter and clients can branch on `code`
 * instead of parsing prose.
 */
export abstract class DomainError extends Error {
  abstract readonly code: string;
  abstract readonly status: number;
  readonly details?: Record<string, unknown>;

  protected constructor(message: string, details?: Record<string, unknown>) {
    super(message);
    this.name = new.target.name;
    this.details = details;
  }
}

export class NotFoundError extends DomainError {
  readonly code = 'not_found';
  readonly status = 404;

  constructor(resource: string, id: string) {
    super(`${resource} ${id} was not found.`, { resource, id });
  }
}

export class ConflictError extends DomainError {
  readonly code: string;
  readonly status = 409;

  constructor(message: string, code = 'conflict', details?: Record<string, unknown>) {
    super(message, details);
    this.code = code;
  }
}

export class ValidationError extends DomainError {
  readonly code = 'invalid_request';
  readonly status = 422;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class UnauthorizedError extends DomainError {
  readonly code = 'unauthorized';
  readonly status = 401;

  constructor(message = 'A valid API key is required.') {
    super(message);
  }
}

export class ForbiddenError extends DomainError {
  readonly code = 'forbidden';
  readonly status = 403;

  constructor(message: string, details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class RateLimitedError extends DomainError {
  readonly code = 'rate_limited';
  readonly status = 429;

  constructor(
    message: string,
    readonly retryAfterSeconds: number,
    details?: Record<string, unknown>,
  ) {
    super(message, details);
  }
}
