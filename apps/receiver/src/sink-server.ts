import { IncomingMessage, Server, ServerResponse, createServer } from 'node:http';
import { SIGNATURE_HEADER, verifySignature } from '@hookline/signature';
import { Behaviour, DEFAULT_BEHAVIOUR, shouldFail } from './behaviour';
import { RequestLog } from './request-log';

const MAX_BODY_BYTES = 1_048_576;

/**
 * The webhook sink: a destination whose behaviour can be changed while a demonstration is running.
 *
 * It verifies signatures with the same package the sender signs with, which is the point - the
 * signature contract is exercised by an independent process rather than asserted by the component
 * that produced it. An invalid signature is refused with 401, exactly as a real consumer should.
 */
export class SinkServer {
  private server: Server | null = null;
  private behaviour: Behaviour = DEFAULT_BEHAVIOUR;
  private secrets: string[] = [];

  constructor(
    readonly port: number,
    readonly host: string,
    private readonly log: RequestLog,
  ) {}

  get currentBehaviour(): Behaviour {
    return this.behaviour;
  }

  get listening(): boolean {
    return this.server !== null;
  }

  get secretCount(): number {
    return this.secrets.length;
  }

  /** Replaces the whole set, used when a launcher establishes the receiver's starting state. */
  setSecrets(secrets: readonly string[]): void {
    this.secrets = [...new Set(secrets)];
  }

  /**
   * Adds secrets without discarding the ones already held. A receiver standing in for several
   * destinations has to verify all of them, so a caller that only knows its own secret must not be
   * able to silently break the others.
   */
  addSecrets(secrets: readonly string[]): void {
    this.secrets = [...new Set([...this.secrets, ...secrets])];
  }

  /**
   * Applies a behaviour change, starting or stopping the listener when the mode crosses into or
   * out of `offline`. Stopping the listener is what makes the outage real: the sender sees a
   * refused connection, not a polite error page.
   */
  async apply(behaviour: Behaviour): Promise<void> {
    this.behaviour = behaviour;
    if (behaviour.mode === 'offline') await this.stop();
    else await this.start();
  }

  async start(): Promise<void> {
    if (this.server) return;
    const server = createServer((request, response) => {
      void this.handle(request, response);
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.port, this.host, () => {
        server.removeListener('error', reject);
        resolve();
      });
    });
    this.server = server;
  }

  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    await new Promise<void>((resolve) => server.close(() => resolve()));
    // Keep-alive sockets would otherwise hold the "outage" open for the sender.
    server.closeAllConnections?.();
  }

  private async handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
    const startedAt = process.hrtime.bigint();
    const body = await readBody(request, response);
    if (body === null) return;

    const header = request.headers[SIGNATURE_HEADER];
    const verification = this.behaviour.verifySignature
      ? verifySignature({
          payload: body,
          header: Array.isArray(header) ? header[0] : header,
          secrets: this.secrets,
        })
      : null;

    if (this.behaviour.latencyMs > 0) await delay(this.behaviour.latencyMs);

    const status = this.decideStatus(verification);
    const headers: Record<string, string> = { 'content-type': 'application/json' };
    if (status >= 400 && this.behaviour.retryAfterSeconds !== null)
      headers['retry-after'] = String(this.behaviour.retryAfterSeconds);

    this.log.record({
      receivedAt: new Date().toISOString(),
      path: request.url ?? '/',
      eventId: single(request.headers['hookline-event-id']),
      eventType: single(request.headers['hookline-event-type']),
      deliveryId: single(request.headers['hookline-delivery-id']),
      attempt: Number(single(request.headers['hookline-attempt'])) || null,
      signature: verification === null ? 'unchecked' : verification.valid ? 'valid' : 'invalid',
      signatureReason: verification?.valid === false ? verification.reason : null,
      statusReturned: status,
      handledInMs: Math.round(Number(process.hrtime.bigint() - startedAt) / 1e6),
      body,
    });

    response.writeHead(status, headers).end(
      JSON.stringify(
        status < 300
          ? { received: true }
          : {
              received: false,
              reason: status === 401 ? 'invalid_signature' : 'simulated_failure',
            },
      ),
    );
  }

  private decideStatus(verification: { valid: boolean } | null): number {
    // A failed signature check outranks the simulated behaviour: a consumer that cannot verify a
    // request has no business processing it, whatever else is being rehearsed.
    if (verification && !verification.valid) return 401;
    return shouldFail(this.behaviour) ? this.behaviour.statusCode : 200;
  }
}

function single(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  return Array.isArray(value) ? (value[0] ?? null) : value;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

/** Reads the raw body, which is what the signature covers; a re-serialized body would not match. */
async function readBody(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<string | null> {
  const chunks: Buffer[] = [];
  let received = 0;
  for await (const chunk of request) {
    received += (chunk as Buffer).length;
    if (received > MAX_BODY_BYTES) {
      response.writeHead(413).end();
      request.destroy();
      return null;
    }
    chunks.push(chunk as Buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}
