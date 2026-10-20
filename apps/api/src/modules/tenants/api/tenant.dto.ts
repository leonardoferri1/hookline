import { ApiProperty } from '@nestjs/swagger';
import { Principal } from '../application/principal';

export class TenantLimitsView {
  @ApiProperty({ example: 120 }) ingestRatePerMinute!: number;
  @ApiProperty({ example: 60 }) ingestBurst!: number;
  @ApiProperty({ example: 20 }) maxEndpoints!: number;
}

export class CurrentPrincipalView {
  @ApiProperty({ example: 'acme' }) slug!: string;
  @ApiProperty({ example: 'Acme Payments' }) name!: string;
  @ApiProperty({ example: 'Console key' }) apiKeyName!: string;
  @ApiProperty({ example: ['endpoints:read'], isArray: true, type: String }) scopes!: string[];
  @ApiProperty({ type: TenantLimitsView }) limits!: TenantLimitsView;

  static from(principal: Principal): CurrentPrincipalView {
    return {
      slug: principal.tenant.slug,
      name: principal.tenant.name,
      apiKeyName: principal.apiKeyName,
      scopes: [...principal.scopes],
      limits: { ...principal.tenant.limits },
    };
  }
}
