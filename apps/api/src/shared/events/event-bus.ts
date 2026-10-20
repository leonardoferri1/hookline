import { Observable } from 'rxjs';
import { StreamEvent } from './stream-event';

/**
 * Fan-out of operational events to connected consoles.
 *
 * Publishing must never be able to fail a delivery: the bus is told about work that already
 * committed, so implementations swallow their own transport errors and log them.
 */
export abstract class EventBus {
  abstract publish(event: StreamEvent): void;
  /** Events for one tenant only; the stream is per-tenant by construction, not by filtering later. */
  abstract subscribe(tenantId: string): Observable<StreamEvent>;
}
