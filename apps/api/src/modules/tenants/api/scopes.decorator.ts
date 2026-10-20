import { SetMetadata, createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { Principal } from '../application/principal';
import { Scope } from '../domain/scope';

export const REQUIRED_SCOPES = 'hookline:required-scopes';

/** Declares the scopes a handler requires; enforced by `ApiKeyGuard`. */
export const RequireScopes = (...scopes: Scope[]) => SetMetadata(REQUIRED_SCOPES, scopes);

export interface AuthenticatedRequest extends Request {
  principal?: Principal;
}

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.principal) throw new Error('ApiKeyGuard must run before CurrentPrincipal.');
    return request.principal;
  },
);
