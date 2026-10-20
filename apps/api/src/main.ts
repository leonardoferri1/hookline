import { loadAppConfig } from './config/app-config';
import { createApiApp } from './bootstrap';

async function main(): Promise<void> {
  const config = loadAppConfig();
  const app = await createApiApp({ config });
  await app.listen(config.port, '127.0.0.1');
  process.stdout.write(
    `${JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'log',
      message: 'api.started',
      url: `http://127.0.0.1:${config.port}/api`,
      docs: `http://127.0.0.1:${config.port}/api/docs`,
      mode: config.mode,
    })}\n`,
  );
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
