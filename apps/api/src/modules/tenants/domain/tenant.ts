export interface TenantLimits {
  /** Tokens restored per minute in the ingest bucket. */
  readonly ingestRatePerMinute: number;
  /** Maximum tokens the ingest bucket may hold. */
  readonly ingestBurst: number;
  readonly maxEndpoints: number;
}

export interface Tenant {
  readonly id: string;
  readonly slug: string;
  readonly name: string;
  readonly limits: TenantLimits;
  readonly createdAt: Date;
}
