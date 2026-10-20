import { Global, Module } from '@nestjs/common';
import { Clock, SystemClock } from '../clock/clock';
import { Database } from './database.service';

@Global()
@Module({
  providers: [Database, { provide: Clock, useClass: SystemClock }],
  exports: [Database, Clock],
})
export class DatabaseModule {}
