import { Module } from '@nestjs/common';
import { TenantsModule } from '../tenants/tenants.module';
import { StreamController } from './api/stream.controller';

@Module({ imports: [TenantsModule], controllers: [StreamController] })
export class StreamModule {}
