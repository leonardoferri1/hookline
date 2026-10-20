import { Controller, Sse, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Observable, map, merge, timer } from 'rxjs';
import { EventBus } from '../../../shared/events/event-bus';
import { StreamEvent } from '../../../shared/events/stream-event';
import { ApiKeyGuard } from '../../tenants/api/api-key.guard';
import { CurrentPrincipal, RequireScopes } from '../../tenants/api/scopes.decorator';
import { Principal } from '../../tenants/application/principal';

/** Idle connections are kept alive through proxies that close a silent stream. */
const HEARTBEAT_INTERVAL_MS = 20_000;

interface StreamMessage {
  type: string;
  data: StreamEvent | { kind: 'heartbeat'; at: string };
}

@ApiTags('stream')
@ApiSecurity('apiKey')
@Controller('stream')
@UseGuards(ApiKeyGuard)
export class StreamController {
  constructor(private readonly bus: EventBus) {}

  /**
   * Server-sent events rather than WebSockets: the traffic is one-way, SSE reconnects on its own,
   * and it travels over plain HTTP with the same API key and the same proxies as every other
   * request. The subscription is created per tenant, so cross-tenant events never enter the
   * stream in the first place.
   */
  @Sse()
  @RequireScopes('deliveries:read')
  @ApiOperation({
    summary: 'Live stream of published events, delivery attempts and breaker transitions.',
    description: 'A text/event-stream connection. Heartbeats are emitted every 20 seconds.',
  })
  stream(@CurrentPrincipal() principal: Principal): Observable<StreamMessage> {
    const events = this.bus
      .subscribe(principal.tenant.id)
      .pipe(map((event): StreamMessage => ({ type: event.kind, data: event })));

    const heartbeats = timer(HEARTBEAT_INTERVAL_MS, HEARTBEAT_INTERVAL_MS).pipe(
      map((): StreamMessage => ({
        type: 'heartbeat',
        data: { kind: 'heartbeat', at: new Date().toISOString() },
      })),
    );

    return merge(events, heartbeats);
  }
}
