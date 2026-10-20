import {
  Inject,
  Injectable,
  Logger,
  OnApplicationBootstrap,
  OnApplicationShutdown,
} from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { hostname } from 'node:os';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { Clock } from '../../../shared/clock/clock';
import { DeliveryQueue } from '../domain/queue.repository';
import { DeliveryDispatcher, DispatchResult } from './delivery-dispatcher.service';

/** Lease recovery runs once every N cycles rather than on every one. */
const RECOVERY_EVERY_CYCLES = 20;

/**
 * The dispatch loop: claim a batch, send it concurrently, repeat; sleep only when the queue is
 * empty.
 *
 * Several instances of this worker may run at once - the claim query hands out disjoint work - so
 * the loop carries no queue state of its own. Shutdown stops claiming and waits for the requests
 * already in the air, because abandoning them would leave leases to expire and produce a
 * duplicate delivery a minute later.
 */
@Injectable()
export class DispatchWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DispatchWorker.name);
  readonly workerId = `${hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

  private running = false;
  private loop: Promise<void> = Promise.resolve();
  private inFlight = new Set<Promise<DispatchResult>>();
  private wakeUp: (() => void) | null = null;
  private cycles = 0;

  constructor(
    private readonly queue: DeliveryQueue,
    private readonly dispatcher: DeliveryDispatcher,
    private readonly clock: Clock,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  onApplicationBootstrap(): void {
    if (!this.config.dispatch.enabled) {
      this.logger.warn({ message: 'dispatcher.disabled' });
      return;
    }
    this.running = true;
    this.loop = this.run();
    this.logger.log({ message: 'dispatcher.started', workerId: this.workerId });
  }

  async onApplicationShutdown(): Promise<void> {
    this.running = false;
    this.wakeUp?.();
    await this.loop;
    await Promise.allSettled([...this.inFlight]);
  }

  private async run(): Promise<void> {
    while (this.running) {
      try {
        const claimed = await this.tick();
        if (claimed === 0) await this.idle();
      } catch (error) {
        this.logger.error({
          message: 'dispatcher.cycle_failed',
          error: (error as Error).message,
        });
        await this.idle();
      }
    }
  }

  /**
   * Runs one cycle and resolves once every delivery in the batch has been settled. Returning the
   * count lets both the loop and the tests know whether there was work.
   */
  async tick(): Promise<number> {
    this.cycles += 1;
    if (this.cycles % RECOVERY_EVERY_CYCLES === 1) await this.recoverLeases();

    const batch = await this.queue.claimDue(
      this.workerId,
      this.config.dispatch.batchSize,
      this.clock.now(),
      this.config.dispatch.leaseSeconds,
    );
    if (batch.length === 0) return 0;

    const work = batch.map((delivery) => {
      const promise = this.dispatcher.dispatch(delivery);
      this.inFlight.add(promise);
      return promise.finally(() => this.inFlight.delete(promise));
    });

    /*
     * One delivery that cannot even be recorded must not take the batch down with it: its lease
     * will expire and the work returns to the queue. But it is logged loudly, because a dispatch
     * that throws here means the queue could not be written, and a silently swallowed rejection
     * would look exactly like a destination that never answers.
     */
    const settled = await Promise.allSettled(work);
    for (const [index, result] of settled.entries())
      if (result.status === 'rejected')
        this.logger.error({
          message: 'delivery.dispatch_failed',
          deliveryId: batch[index]?.deliveryId,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        });

    return batch.length;
  }

  /** Drains the queue, used by tests and by the demonstration lab to force progress. */
  async drain(maxCycles = 50): Promise<number> {
    let dispatched = 0;
    for (let cycle = 0; cycle < maxCycles; cycle += 1) {
      const claimed = await this.tick();
      if (claimed === 0) break;
      dispatched += claimed;
    }
    return dispatched;
  }

  private async recoverLeases(): Promise<void> {
    const recovered = await this.queue.recoverExpiredLeases(this.clock.now());
    if (recovered > 0)
      this.logger.warn({ message: 'dispatcher.leases_recovered', count: recovered });
  }

  /** Sleeps until the idle interval elapses or shutdown interrupts it. */
  private idle(): Promise<void> {
    return new Promise<void>((resolve) => {
      const timer = setTimeout(() => {
        this.wakeUp = null;
        resolve();
      }, this.config.dispatch.idleIntervalMs);
      // Never hold the process open for a sleep.
      timer.unref();
      this.wakeUp = () => {
        clearTimeout(timer);
        this.wakeUp = null;
        resolve();
      };
    });
  }
}
