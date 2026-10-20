import { IncomingMessage, ServerResponse, createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { BehaviourError, mergeBehaviour } from './behaviour';
import { RequestLog } from './request-log';
import { SinkServer } from './sink-server';

/**
 * Control plane for the sink, on its own port.
 *
 * Two ports rather than one, because the sink stops listening to simulate an outage - a control
 * API living on the same listener would become unreachable exactly when it is needed to end the
 * outage.
 *
 * Every request carries a bearer token. A remote-controlled HTTP server is a liability even in a
 * development tool, so the token is required and compared in constant time, and the server binds
 * loopback.
 */
export class ControlServer {
  constructor(
    private readonly port: number,
    private readonly host: string,
    private readonly token: string,
    private readonly sink: SinkServer,
    private readonly log: RequestLog,
  ) {}

  async start(): Promise<void> {
    const server = createServer((request, response) => {
      void this.route(request, response).catch((error: unknown) => {
        respond(response, 500, { message: (error as Error).message });
      });
    });
    await new Promise<void>((resolve) => server.listen(this.port, this.host, () => resolve()));
  }

  private async route(request: IncomingMessage, response: ServerResponse): Promise<void> {
    response.setHeader('access-control-allow-origin', '*');
    response.setHeader('access-control-allow-headers', 'authorization, content-type');
    response.setHeader('access-control-allow-methods', 'GET, PUT, POST, DELETE, OPTIONS');
    if (request.method === 'OPTIONS') {
      response.writeHead(204).end();
      return;
    }

    if (!this.authorized(request)) {
      respond(response, 401, { message: 'A valid control token is required.' });
      return;
    }

    const path = (request.url ?? '/').split('?')[0];
    const method = request.method ?? 'GET';

    if (path === '/control' && method === 'GET') {
      respond(response, 200, this.state());
      return;
    }
    if (path === '/control' && method === 'PUT') {
      await this.updateBehaviour(request, response);
      return;
    }
    if (path === '/control/secrets' && method === 'PUT') {
      await this.updateSecrets(request, response);
      return;
    }
    if (path === '/control/requests' && method === 'DELETE') {
      this.log.clear();
      respond(response, 200, this.state());
      return;
    }
    respond(response, 404, { message: `No control route for ${method} ${String(path)}.` });
  }

  private state(): Record<string, unknown> {
    return {
      behaviour: this.sink.currentBehaviour,
      listening: this.sink.listening,
      url: `http://${this.sink.host}:${this.sink.port}`,
      secretsConfigured: this.sink.secretCount,
      totalRequests: this.log.total,
      requests: this.log.list(50),
    };
  }

  private async updateBehaviour(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const patch = await readJson(request);
      const behaviour = mergeBehaviour(this.sink.currentBehaviour, patch);
      await this.sink.apply(behaviour);
      respond(response, 200, this.state());
    } catch (error) {
      if (error instanceof BehaviourError) respond(response, 422, { message: error.message });
      else respond(response, 400, { message: (error as Error).message });
    }
  }

  /**
   * The console pushes the endpoint's signing secrets here so the sink can verify what it
   * receives. They are held in memory only, and they are the demonstration endpoint's secrets -
   * no production value ever reaches this process.
   */
  private async updateSecrets(request: IncomingMessage, response: ServerResponse): Promise<void> {
    try {
      const body = (await readJson(request)) as { secrets?: unknown };
      const secrets = Array.isArray(body.secrets) ? body.secrets.map(String) : null;
      if (!secrets || secrets.length === 0) {
        respond(response, 422, { message: 'secrets must be a non-empty array of strings.' });
        return;
      }
      this.sink.setSecrets(secrets);
      respond(response, 200, this.state());
    } catch (error) {
      respond(response, 400, { message: (error as Error).message });
    }
  }

  private authorized(request: IncomingMessage): boolean {
    const header = request.headers.authorization;
    if (!header) return false;
    const [scheme, value] = header.split(' ');
    if (scheme?.toLowerCase() !== 'bearer' || !value) return false;
    const presented = Buffer.from(value);
    const expected = Buffer.from(this.token);
    return presented.length === expected.length && timingSafeEqual(presented, expected);
  }
}

function respond(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString('utf8').trim();
  if (!raw) return {};
  return JSON.parse(raw);
}
