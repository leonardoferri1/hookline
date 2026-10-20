import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { requestContext } from './request-context';

/**
 * Emits one JSON object per line and attaches the ambient request id, so a delivery can be traced
 * from the ingest call through every dispatch attempt with `grep`, or with a log pipeline that
 * expects structured input. Tests silence it by passing an empty level list.
 */
export class StructuredLogger extends ConsoleLogger {
  constructor(private readonly levels: LogLevel[] = ['log', 'warn', 'error']) {
    super();
  }

  private write(level: LogLevel, message: unknown, context?: unknown): void {
    if (!this.levels.includes(level)) return;
    const ambient = requestContext.current();
    const payload: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      context: typeof context === 'string' ? context : undefined,
      ...(ambient ? { requestId: ambient.requestId, tenantId: ambient.tenantId } : {}),
    };
    if (message && typeof message === 'object') Object.assign(payload, message);
    else payload.message = String(message);
    process.stdout.write(`${JSON.stringify(payload)}\n`);
  }

  override log(message: unknown, context?: unknown): void {
    this.write('log', message, context);
  }

  override warn(message: unknown, context?: unknown): void {
    this.write('warn', message, context);
  }

  override error(message: unknown, stackOrContext?: unknown, context?: unknown): void {
    this.write('error', message, context ?? stackOrContext);
  }

  override debug(message: unknown, context?: unknown): void {
    this.write('debug', message, context);
  }

  override verbose(message: unknown, context?: unknown): void {
    this.write('verbose', message, context);
  }
}
