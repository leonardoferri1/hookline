import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayNotEmpty,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Endpoint, EndpointSecret } from '../domain/endpoint';
import { MAX_EVENT_TYPE_LENGTH } from '../domain/event-type';
import { MAX_URL_LENGTH } from '../domain/destination-url';

export class CreateEndpointBody {
  @ApiProperty({ example: 'Billing service' })
  @IsString()
  @MinLength(1)
  @MaxLength(80)
  name!: string;

  @ApiProperty({ example: 'http://127.0.0.1:3022/hooks/billing' })
  @IsString()
  @MaxLength(MAX_URL_LENGTH)
  url!: string;

  @ApiPropertyOptional({ example: 'Receives payment lifecycle events.' })
  @IsOptional()
  @IsString()
  @MaxLength(280)
  description?: string;

  @ApiProperty({
    example: ['order.*', 'invoice.paid'],
    description: 'An exact event type, a prefix ending in ".*", or "*" for every event.',
    isArray: true,
    type: String,
  })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(MAX_EVENT_TYPE_LENGTH, { each: true })
  eventTypes!: string[];

  @ApiPropertyOptional({ example: 6, minimum: 1, maximum: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional({ example: 10000, minimum: 500, maximum: 30000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(30000)
  timeoutMs?: number;

  @ApiPropertyOptional({
    example: false,
    description: 'Deliver events that share a partition key one at a time, in ingest order.',
  })
  @IsOptional()
  @IsBoolean()
  ordered?: boolean;
}

export class UpdateEndpointBody {
  @ApiPropertyOptional() @IsOptional() @IsString() @MinLength(1) @MaxLength(80) name?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(MAX_URL_LENGTH) url?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(280) description?: string;

  @ApiPropertyOptional({ isArray: true, type: String })
  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayMaxSize(50)
  @IsString({ each: true })
  @MaxLength(MAX_EVENT_TYPE_LENGTH, { each: true })
  eventTypes?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(20)
  maxAttempts?: number;

  @ApiPropertyOptional()
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(500)
  @Max(30000)
  timeoutMs?: number;

  @ApiPropertyOptional() @IsOptional() @IsBoolean() ordered?: boolean;

  @ApiPropertyOptional({ enum: ['enabled', 'paused'] })
  @IsOptional()
  @IsIn(['enabled', 'paused'])
  status?: 'enabled' | 'paused';
}

export class RotateSecretBody {
  @ApiPropertyOptional({
    example: 86400,
    description: 'Seconds the replaced secret keeps signing alongside its successor.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(604800)
  graceSeconds?: number;
}

export class EndpointHealthView {
  @ApiProperty({ enum: ['closed', 'open', 'half_open'] }) circuitState!: string;
  @ApiProperty() consecutiveFailures!: number;
  @ApiProperty({ nullable: true, type: String }) circuitOpenedAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) circuitRetryAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastSuccessAt!: string | null;
  @ApiProperty({ nullable: true, type: String }) lastFailureAt!: string | null;
}

export class EndpointView {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty() url!: string;
  @ApiProperty({ nullable: true, type: String }) description!: string | null;
  @ApiProperty({ enum: ['enabled', 'paused'] }) status!: string;
  @ApiProperty({ isArray: true, type: String }) eventTypes!: string[];
  @ApiProperty() maxAttempts!: number;
  @ApiProperty() timeoutMs!: number;
  @ApiProperty() ordered!: boolean;
  @ApiProperty({ type: EndpointHealthView }) health!: EndpointHealthView;
  @ApiProperty() createdAt!: string;
  @ApiProperty() updatedAt!: string;

  static from(endpoint: Endpoint): EndpointView {
    return {
      id: endpoint.id,
      name: endpoint.name,
      url: endpoint.url,
      description: endpoint.description,
      status: endpoint.status,
      eventTypes: [...endpoint.eventTypes],
      maxAttempts: endpoint.maxAttempts,
      timeoutMs: endpoint.timeoutMs,
      ordered: endpoint.ordered,
      health: {
        circuitState: endpoint.health.circuitState,
        consecutiveFailures: endpoint.health.consecutiveFailures,
        circuitOpenedAt: endpoint.health.circuitOpenedAt?.toISOString() ?? null,
        circuitRetryAt: endpoint.health.circuitRetryAt?.toISOString() ?? null,
        lastSuccessAt: endpoint.health.lastSuccessAt?.toISOString() ?? null,
        lastFailureAt: endpoint.health.lastFailureAt?.toISOString() ?? null,
      },
      createdAt: endpoint.createdAt.toISOString(),
      updatedAt: endpoint.updatedAt.toISOString(),
    };
  }
}

export class CreatedEndpointView {
  @ApiProperty({ type: EndpointView }) endpoint!: EndpointView;

  @ApiProperty({
    example: 'whsec_...',
    description: 'Shown once. Hookline keeps it to sign requests but will not display it again.',
  })
  secret!: string;
}

/** Secret metadata, never the secret itself: listing it would defeat showing it once. */
export class EndpointSecretView {
  @ApiProperty() id!: string;
  @ApiProperty({ example: 'whsec_…abcd', description: 'Last four characters only.' })
  hint!: string;
  @ApiProperty() createdAt!: string;
  @ApiProperty({ nullable: true, type: String }) expiresAt!: string | null;
  @ApiProperty() active!: boolean;

  static from(secret: EndpointSecret, now: Date): EndpointSecretView {
    return {
      id: secret.id,
      hint: `whsec_…${secret.secret.slice(-4)}`,
      createdAt: secret.createdAt.toISOString(),
      expiresAt: secret.expiresAt?.toISOString() ?? null,
      active: secret.expiresAt === null || secret.expiresAt > now,
    };
  }
}
