import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { Observable, Subject, filter } from 'rxjs';
import { Client } from 'pg';
import { APP_CONFIG, AppConfig } from '../../config/app-config';
import { Database } from '../database/database.service';
import { EventBus } from './event-bus';
import { STREAM_CHANNEL, StreamEvent } from './stream-event';

const RECONNECT_DELAY_MS = 1000;
const MAX_RECONNECT_DELAY_MS = 30_000;

/**
 * Carries operational events over PostgreSQL `LISTEN`/`NOTIFY`.
 *
 * An in-process emitter would be simpler, and wrong as soon as there is more than one API
 * instance: a console connected to instance A would never see a delivery dispatched by instance
 * B, and the dashboard would look idle while work was flowing. Routing through the database the
 * whole system already depends on keeps the stream correct without adding a broker.
 *
 * The listener owns a dedicated connection rather than borrowing from the pool, because a
 * listening session cannot be returned and reused. It reconnects with backoff: a dropped listener
 * degrades the live view, so it must not degrade anything else, and a console that reconnects
 * re-reads current state anyway.
 */
@Injectable()
export class PostgresEventBus
  extends EventBus
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(PostgresEventBus.name);
  private readonly events = new Subject<StreamEvent>();
  private listener: Client | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private reconnectDelay = RECONNECT_DELAY_MS;
  private stopped = false;

  constructor(
    private readonly database: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {
    super();
  }

  async onApplicationBootstrap(): Promise<void> {
    await this.connect();
  }

  async onApplicationShutdown(): Promise<void> {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.events.complete();
    const listener = this.listener;
    this.listener = null;
    await listener?.end().catch(() => undefined);
  }

  publish(event: StreamEvent): void {
    void this.database
      .query('SELECT pg_notify($1, $2)', [STREAM_CHANNEL, JSON.stringify(event)])
      .catch((error: unknown) => {
        // The work this describes is already committed; losing its notification is cosmetic.
        this.logger.warn({
          message: 'stream.publish_failed',
          kind: event.kind,
          error: (error as Error).message,
        });
      });
  }

  subscribe(tenantId: string): Observable<StreamEvent> {
    return this.events.pipe(filter((event) => event.tenantId === tenantId));
  }

  private async connect(): Promise<void> {
    if (this.stopped) return;
    const client = new Client({
      connectionString: this.config.databaseUrl,
      application_name: 'hookline-stream-listener',
    });

    client.on('notification', (message) => {
      if (message.channel !== STREAM_CHANNEL || !message.payload) return;
      try {
        this.events.next(JSON.parse(message.payload) as StreamEvent);
      } catch {
        this.logger.warn({ message: 'stream.payload_unreadable' });
      }
    });
    client.on('error', (error) => {
      this.logger.warn({ message: 'stream.listener_error', error: error.message });
      this.scheduleReconnect();
    });
    client.on('end', () => this.scheduleReconnect());

    try {
      await client.connect();
      await client.query(`LISTEN ${STREAM_CHANNEL}`);
      this.listener = client;
      this.reconnectDelay = RECONNECT_DELAY_MS;
      this.logger.log({ message: 'stream.listening', channel: STREAM_CHANNEL });
    } catch (error) {
      this.logger.warn({ message: 'stream.listen_failed', error: (error as Error).message });
      await client.end().catch(() => undefined);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect(): void {
    if (this.stopped || this.reconnectTimer) return;
    this.listener = null;
    const delay = this.reconnectDelay;
    this.reconnectDelay = Math.min(MAX_RECONNECT_DELAY_MS, delay * 2);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      void this.connect();
    }, delay);
    this.reconnectTimer.unref();
  }
}
