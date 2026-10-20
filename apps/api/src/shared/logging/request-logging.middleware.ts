import { randomUUID } from 'node:crypto';
import { NextFunction, Request, Response } from 'express';
import { LoggerService } from '@nestjs/common';
import { requestContext } from './request-context';

/**
 * Assigns a request id, publishes it on the response and in the ambient context, and logs one
 * completion line per request. Callers may supply their own `X-Request-Id` so a trace can be
 * followed across the console, the API and the receiver.
 */
export function requestLogging(logger: LoggerService) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const supplied = request.header('x-request-id');
    const requestId = supplied && /^[\w.:-]{8,128}$/.test(supplied) ? supplied : randomUUID();
    response.setHeader('X-Request-Id', requestId);
    const startedAt = process.hrtime.bigint();
    requestContext.run({ requestId }, () => {
      response.on('finish', () => {
        const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
        logger.log({
          message: 'request.completed',
          method: request.method,
          path: request.route?.path ?? request.path,
          status: response.statusCode,
          durationMs: Math.round(durationMs * 100) / 100,
        });
      });
      next();
    });
  };
}
