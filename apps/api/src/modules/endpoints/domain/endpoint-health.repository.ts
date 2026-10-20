import { Queryable } from '../../../shared/database/database.service';
import { CircuitState, EndpointHealth } from './endpoint';

export interface BreakerSettings {
  readonly failureThreshold: number;
  readonly baseCooldownSeconds: number;
  readonly maxCooldownSeconds: number;
}

export interface HealthTransition {
  readonly endpointId: string;
  readonly previous: CircuitState;
  readonly health: EndpointHealth;
  /** True when this outcome changed the breaker state. */
  readonly changed: boolean;
}

/**
 * Delivery health of a destination, updated by the dispatcher after every attempt.
 *
 * Both operations are single atomic statements rather than read-modify-write: several dispatchers
 * can be attempting deliveries for the same endpoint at the same moment, and a lost increment
 * would keep a dead destination's breaker closed.
 */
export abstract class EndpointHealthRepository {
  abstract recordSuccess(
    endpointId: string,
    at: Date,
    client?: Queryable,
  ): Promise<HealthTransition | null>;

  abstract recordFailure(
    endpointId: string,
    at: Date,
    settings: BreakerSettings,
    client?: Queryable,
  ): Promise<HealthTransition | null>;
}
