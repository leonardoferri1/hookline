import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ForbiddenError, UnauthorizedError } from '../../../shared/errors/domain-error';
import { requestContext } from '../../../shared/logging/request-context';
import { AuthenticateApiKey } from '../application/authenticate-api-key.use-case';
import { hasScopes } from '../application/principal';
import { Scope } from '../domain/scope';
import { AuthenticatedRequest, REQUIRED_SCOPES } from './scopes.decorator';

/**
 * Authenticates the bearer token, enforces the scopes declared on the handler and publishes the
 * tenant id into the ambient log context, so every line emitted while serving the request can be
 * attributed without threading the principal through call sites.
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    private readonly authenticate: AuthenticateApiKey,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const principal = await this.authenticate.execute(readToken(request));

    const required =
      this.reflector.getAllAndOverride<Scope[]>(REQUIRED_SCOPES, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (!hasScopes(principal, required))
      throw new ForbiddenError('The API key is missing a required scope.', {
        required,
        granted: principal.scopes,
      });

    request.principal = principal;
    const ambient = requestContext.current();
    if (ambient) ambient.tenantId = principal.tenant.id;
    return true;
  }
}

function readToken(request: AuthenticatedRequest): string | undefined {
  const authorization = request.header('authorization');
  if (authorization) {
    const [scheme, value] = authorization.split(' ');
    if (!value || scheme?.toLowerCase() !== 'bearer')
      throw new UnauthorizedError('Use the Authorization: Bearer <api key> header.');
    return value;
  }
  return request.header('x-api-key') ?? undefined;
}
