import { ControlServer } from './control-server';
import { RequestLog } from './request-log';
import { SinkServer } from './sink-server';

const HOST = '127.0.0.1';

async function main(): Promise<void> {
  const sinkPort = Number(process.env.RECEIVER_PORT ?? 3022);
  const controlPort = Number(process.env.RECEIVER_CONTROL_PORT ?? 3023);
  const token = process.env.RECEIVER_CONTROL_TOKEN;
  if (!token || token.length < 16)
    throw new Error('RECEIVER_CONTROL_TOKEN is required and must be at least 16 characters.');

  const log = new RequestLog();
  const sink = new SinkServer(sinkPort, HOST, log);
  const control = new ControlServer(controlPort, HOST, token, sink, log);

  await sink.start();
  await control.start();

  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'log',
      message: 'receiver.started',
      sink: `http://${HOST}:${sinkPort}/hooks/demo`,
      control: `http://${HOST}:${controlPort}/control`,
    })}\n`,
  );

  const shutdown = (): void => {
    void sink.stop().finally(() => process.exit(0));
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
