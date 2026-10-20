import { Controller, Get, VERSION_NEUTRAL } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Database } from '../database/database.service';

@ApiTags('operations')
// Probes stay outside API versioning: orchestrators should not have to track a version to
// decide whether the process is alive.
@Controller({ path: 'health', version: VERSION_NEUTRAL })
export class HealthController {
  constructor(private readonly database: Database) {}

  @Get()
  @ApiOperation({ summary: 'Liveness probe that does not touch dependencies.' })
  live(): { status: 'ok'; uptimeSeconds: number } {
    return { status: 'ok', uptimeSeconds: Math.round(process.uptime()) };
  }

  @Get('ready')
  @ApiOperation({ summary: 'Readiness probe that verifies the database connection.' })
  async ready(): Promise<{ status: 'ok'; database: 'reachable' }> {
    await this.database.query('SELECT 1');
    return { status: 'ok', database: 'reachable' };
  }
}
