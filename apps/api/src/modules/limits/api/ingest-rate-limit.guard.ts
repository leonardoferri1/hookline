import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Response } from 'express';
import { RateLimitedError } from '../../../shared/errors/domain-error';
import { AuthenticatedRequest } from '../../tenants/api/scopes.decorator';
import { RateLimiter } from '../domain/rate-limiter';

/**
 * Charges one ingest token to the authenticated tenant. Runs after `ApiKeyGuard`, because the
 * quota belongs to the tenant rather than to the connection: a client that rotates addresses
 * should not get a fresh allowance.
 *
 * Limit headers follow the IETF RateLimit draft field names, and refusals carry `Retry-After` so a
 * well-behaved publisher can back off instead of retrying immediately.
 */
@Injectable()
export class IngestRateLimitGuard implements CanActivate {
  constructor(private readonly limiter: RateLimiter) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const http = context.switchToHttp();
    const request = http.getRequest<AuthenticatedRequest>();
    const response = http.getResponse<Response>();
    const principal = request.principal;
    if (!principal) return true;

    const decision = await this.limiter.consume(principal.tenant.id, {
      burst: principal.tenant.limits.ingestBurst,
      ratePerMinute: principal.tenant.limits.ingestRatePerMinute,
    });

    response.setHeader('RateLimit-Limit', String(decision.limits.burst));
    response.setHeader('RateLimit-Remaining', String(decision.remaining));
    if (!decision.allowed)
      response.setHeader('RateLimit-Reset', String(decision.retryAfterSeconds));

    if (!decision.allowed)
      throw new RateLimitedError(
        'The ingest quota for this tenant is exhausted.',
        decision.retryAfterSeconds,
        {
          burst: decision.limits.burst,
          ratePerMinute: decision.limits.ratePerMinute,
        },
      );
    return true;
  }
}
