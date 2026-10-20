import { Inject, Injectable, OnApplicationShutdown } from '@nestjs/common';
import { Agent as HttpAgent, IncomingMessage, request as httpRequest } from 'node:http';
import { Agent as HttpsAgent, request as httpsRequest } from 'node:https';
import { LookupAddress, lookup as dnsLookup } from 'node:dns';
import { isIP } from 'node:net';
import { SIGNATURE_HEADER, buildSignatureHeader } from '@hookline/signature';
import { APP_CONFIG, AppConfig } from '../../../config/app-config';
import { Clock } from '../../../shared/clock/clock';
import { DeliveryRequest, TransportOutcome, WebhookTransport } from '../domain/transport';
import { classifyAddress } from './address-policy';

const USER_AGENT = 'Hookline/0.1 (+https://github.com/leonardoferri1/hookline)';

/**
 * Sends one signed request over `node:http`/`node:https` rather than `fetch`.
 *
 * Three properties justify the lower-level client:
 *
 * 1. The destination address is resolved once, checked against the address policy, and then
 *    pinned through the `lookup` hook. A separate check followed by an unpinned connect is a
 *    DNS-rebinding hole: the name could resolve to a public address for the check and to an
 *    internal one microseconds later.
 * 2. Redirects are not followed. A 302 is recorded as the failure it is, instead of letting a
 *    destination bounce the sender to an address the policy already refused.
 * 3. The response body is read up to a cap and the socket is then destroyed, so a destination
 *    cannot stream an unbounded body into the attempt log.
 */
@Injectable()
export class HttpWebhookTransport extends WebhookTransport implements OnApplicationShutdown {
  private readonly httpAgent = new HttpAgent({ keepAlive: true, maxSockets: 64 });
  private readonly httpsAgent = new HttpsAgent({ keepAlive: true, maxSockets: 64 });

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly clock: Clock,
  ) {
    super();
  }

  override async send(request: DeliveryRequest): Promise<TransportOutcome> {
    const startedAt = process.hrtime.bigint();
    const elapsed = (): number => Number(process.hrtime.bigint() - startedAt) / 1e6;

    let target: URL;
    try {
      target = new URL(request.url);
    } catch {
      return {
        kind: 'transport_error',
        durationMs: elapsed(),
        reason: 'blocked',
        message: 'The destination URL is not usable.',
      };
    }

    let addresses: LookupAddress[];
    try {
      addresses = await resolveAll(target.hostname);
    } catch (error) {
      return {
        kind: 'transport_error',
        durationMs: elapsed(),
        reason: 'dns',
        message: `The destination host could not be resolved: ${(error as Error).message}`,
      };
    }

    const permitted = addresses.filter(
      (candidate) =>
        this.config.dispatch.allowPrivateDestinations ||
        classifyAddress(candidate.address) === 'public',
    );
    if (permitted.length === 0) {
      const classes = [...new Set(addresses.map((entry) => classifyAddress(entry.address)))];
      return {
        kind: 'transport_error',
        durationMs: elapsed(),
        reason: 'blocked',
        message: `The destination resolves to a non-public address (${classes.join(', ')}).`,
      };
    }

    return this.dispatch(request, target, permitted, elapsed);
  }

  private dispatch(
    request: DeliveryRequest,
    target: URL,
    permitted: LookupAddress[],
    elapsed: () => number,
  ): Promise<TransportOutcome> {
    const secure = target.protocol === 'https:';
    const send = secure ? httpsRequest : httpRequest;
    const timestamp = this.clock.nowSeconds();
    const maxBytes = this.config.dispatch.maxStoredResponseBytes;

    return new Promise<TransportOutcome>((resolve) => {
      let settled = false;
      const finish = (outcome: TransportOutcome): void => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      const outgoing = send(
        target,
        {
          method: 'POST',
          agent: secure ? this.httpsAgent : this.httpAgent,
          timeout: request.timeoutMs,
          lookup: pinnedLookup(permitted),
          headers: {
            'content-type': 'application/json',
            'content-length': Buffer.byteLength(request.body).toString(),
            'user-agent': USER_AGENT,
            accept: 'application/json, text/plain;q=0.9, */*;q=0.8',
            [SIGNATURE_HEADER]: buildSignatureHeader({
              payload: request.body,
              secrets: request.signingSecrets,
              timestamp,
            }),
            'hookline-timestamp': String(timestamp),
            'hookline-event-id': request.eventId,
            'hookline-event-type': request.eventType,
            'hookline-delivery-id': request.deliveryId,
            'hookline-attempt': String(request.attempt),
            'x-request-id': request.requestId,
          },
        },
        (response: IncomingMessage) => {
          const chunks: Buffer[] = [];
          let received = 0;
          let truncated = false;
          response.on('data', (chunk: Buffer) => {
            if (received >= maxBytes) return;
            const room = maxBytes - received;
            if (chunk.length > room) {
              chunks.push(chunk.subarray(0, room));
              received = maxBytes;
              truncated = true;
              response.destroy();
            } else {
              chunks.push(chunk);
              received += chunk.length;
            }
          });
          const complete = (): void =>
            finish({
              kind: 'response',
              statusCode: response.statusCode ?? 0,
              durationMs: elapsed(),
              responseHeaders: collectHeaders(response),
              responseBody: Buffer.concat(chunks).toString('utf8'),
              bodyTruncated: truncated,
            });
          response.on('end', complete);
          // A destroyed socket after the cap is a complete outcome, not an error.
          response.on('close', complete);
          response.on('error', complete);
        },
      );

      outgoing.on('timeout', () => {
        outgoing.destroy();
        finish({
          kind: 'transport_error',
          durationMs: elapsed(),
          reason: 'timeout',
          message: `The destination did not respond within ${request.timeoutMs} ms.`,
        });
      });

      outgoing.on('error', (error: NodeJS.ErrnoException) => {
        finish({
          kind: 'transport_error',
          durationMs: elapsed(),
          reason: classifyError(error),
          message: error.message,
        });
      });

      outgoing.end(request.body);
    });
  }

  onApplicationShutdown(): void {
    this.httpAgent.destroy();
    this.httpsAgent.destroy();
  }
}

/** Resolves every address for a host so the policy can reject a name with any unsafe answer. */
function resolveAll(hostname: string): Promise<LookupAddress[]> {
  const literal = isIP(hostname);
  if (literal) return Promise.resolve([{ address: hostname, family: literal }]);
  return new Promise((resolve, reject) => {
    dnsLookup(hostname, { all: true, verbatim: true }, (error, addresses) => {
      if (error) reject(error);
      else if (addresses.length === 0) reject(new Error('no addresses returned'));
      else resolve(addresses);
    });
  });
}

/**
 * Feeds the connection the addresses that were already checked, which closes the window between
 * the policy decision and the TCP connect.
 */
function pinnedLookup(permitted: LookupAddress[]) {
  const first = permitted[0]!;
  return (
    _hostname: string,
    options: { all?: boolean },
    callback: (
      error: NodeJS.ErrnoException | null,
      address: string | LookupAddress[],
      family?: number,
    ) => void,
  ): void => {
    if (options.all) callback(null, permitted);
    else callback(null, first.address, first.family);
  };
}

function collectHeaders(response: IncomingMessage): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const [name, value] of Object.entries(response.headers)) {
    if (value === undefined) continue;
    headers[name] = Array.isArray(value) ? value.join(', ') : value;
  }
  return headers;
}

function classifyError(error: NodeJS.ErrnoException): string {
  switch (error.code) {
    case 'ECONNREFUSED':
      return 'connection_refused';
    case 'ECONNRESET':
    case 'EPIPE':
      return 'connection_reset';
    case 'ETIMEDOUT':
    case 'ESOCKETTIMEDOUT':
      return 'timeout';
    case 'ENOTFOUND':
    case 'EAI_AGAIN':
      return 'dns';
    case 'EHOSTUNREACH':
    case 'ENETUNREACH':
      return 'unreachable';
    default:
      return error.code?.startsWith('ERR_TLS') || error.code === 'CERT_HAS_EXPIRED'
        ? 'tls'
        : 'unknown';
  }
}
