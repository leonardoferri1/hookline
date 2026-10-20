import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { Delivery, DeliveryState } from '../domain/delivery';
import { DeliveryAttempt, DeliveryListItem } from '../domain/delivery-attempt';

const STATES: DeliveryState[] = ['pending', 'in_flight', 'succeeded', 'failed', 'canceled'];

/** Accepts `?state=failed&state=pending` and `?state=failed,pending` alike. */
const asStateArray = ({ value }: { value: unknown }): unknown => {
  if (value === undefined || value === null) return undefined;
  const raw = Array.isArray(value) ? value : String(value).split(',');
  return raw.map((entry) => String(entry).trim()).filter(Boolean);
};

export class ListDeliveriesQuery {
  @ApiPropertyOptional({ format: 'uuid' })
  @IsOptional()
  @IsUUID()
  endpointId?: string;

  @ApiPropertyOptional({ enum: STATES, isArray: true })
  @IsOptional()
  @Transform(asStateArray)
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(STATES, { each: true })
  state?: DeliveryState[];

  @ApiPropertyOptional({ example: 'order.paid' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  eventType?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(200)
  limit?: number;

  @ApiPropertyOptional({ description: 'Return deliveries created strictly before this timestamp.' })
  @IsOptional()
  @IsDateString()
  before?: string;
}

export class ReplayEndpointBody {
  @ApiProperty({ format: 'uuid' })
  @IsUUID()
  endpointId!: string;

  @ApiPropertyOptional({
    enum: ['succeeded', 'failed', 'canceled'],
    isArray: true,
    description: 'Defaults to ["failed"]. Only settled deliveries can be replayed.',
  })
  @IsOptional()
  @Transform(asStateArray)
  @IsArray()
  @ArrayNotEmpty()
  @IsIn(['succeeded', 'failed', 'canceled'], { each: true })
  states?: DeliveryState[];

  @ApiPropertyOptional({ example: 100, minimum: 1, maximum: 500 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(500)
  limit?: number;
}

export class DeliveryView {
  @ApiProperty() id!: string;
  @ApiProperty({ enum: STATES }) state!: string;
  @ApiProperty() endpointId!: string;
  @ApiProperty() endpointName!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty() eventType!: string;
  @ApiProperty({ nullable: true, type: String }) partitionKey!: string | null;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() maxAttempts!: number;
  @ApiProperty({ nullable: true, type: Number }) lastStatusCode!: number | null;
  @ApiProperty({ nullable: true, type: String }) lastError!: string | null;
  @ApiProperty() nextAttemptAt!: string;
  @ApiProperty({ nullable: true, type: String }) completedAt!: string | null;
  @ApiProperty({
    nullable: true,
    type: Number,
    description: 'Milliseconds from acceptance to a terminal state.',
  })
  settledInMs!: number | null;
  @ApiProperty({
    nullable: true,
    type: String,
    description: 'The delivery this one replays, when it is a replay.',
  })
  replayOf!: string | null;
  @ApiProperty() createdAt!: string;

  static from(item: DeliveryListItem): DeliveryView {
    return {
      id: item.id,
      state: item.state,
      endpointId: item.endpointId,
      endpointName: item.endpointName,
      eventId: item.eventId,
      eventType: item.eventType,
      partitionKey: item.partitionKey,
      attemptCount: item.attemptCount,
      maxAttempts: item.maxAttempts,
      lastStatusCode: item.lastStatusCode,
      lastError: item.lastError,
      nextAttemptAt: item.nextAttemptAt.toISOString(),
      completedAt: item.completedAt?.toISOString() ?? null,
      settledInMs: item.settledInMs,
      replayOf: item.replayOf,
      createdAt: item.createdAt.toISOString(),
    };
  }
}

export class DeliveryAttemptView {
  @ApiProperty() attemptNumber!: number;
  @ApiProperty({ enum: ['succeeded', 'rejected', 'transport_error'] }) outcome!: string;
  @ApiProperty({ nullable: true, type: Number }) statusCode!: number | null;
  @ApiProperty({ nullable: true, type: String }) errorReason!: string | null;
  @ApiProperty({ nullable: true, type: String }) errorMessage!: string | null;
  @ApiProperty() durationMs!: number;
  @ApiProperty({ type: Object }) requestHeaders!: Record<string, string>;
  @ApiProperty({ type: Object }) responseHeaders!: Record<string, string>;
  @ApiProperty({ nullable: true, type: String }) responseBody!: string | null;
  @ApiProperty() responseTruncated!: boolean;
  @ApiProperty() startedAt!: string;

  static from(attempt: DeliveryAttempt): DeliveryAttemptView {
    return {
      attemptNumber: attempt.attemptNumber,
      outcome: attempt.outcome,
      statusCode: attempt.statusCode,
      errorReason: attempt.errorReason,
      errorMessage: attempt.errorMessage,
      durationMs: attempt.durationMs,
      requestHeaders: attempt.requestHeaders,
      responseHeaders: attempt.responseHeaders,
      responseBody: attempt.responseBody,
      responseTruncated: attempt.responseTruncated,
      startedAt: attempt.startedAt.toISOString(),
    };
  }
}

export class DeliveryDetailView {
  @ApiProperty({ type: DeliveryView }) delivery!: DeliveryView;
  @ApiProperty({ type: DeliveryAttemptView, isArray: true }) attempts!: DeliveryAttemptView[];
}

/** A freshly queued delivery: it has no attempts or endpoint labels to report yet. */
export class ReplayedDeliveryView {
  @ApiProperty() id!: string;
  @ApiProperty() endpointId!: string;
  @ApiProperty() eventId!: string;
  @ApiProperty({ enum: STATES }) state!: string;
  @ApiProperty() maxAttempts!: number;
  @ApiProperty() nextAttemptAt!: string;
  @ApiProperty({ nullable: true, type: String }) replayOf!: string | null;

  static from(delivery: Delivery): ReplayedDeliveryView {
    return {
      id: delivery.id,
      endpointId: delivery.endpointId,
      eventId: delivery.eventId,
      state: delivery.state,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
      replayOf: delivery.replayOf,
    };
  }
}

export class BulkReplayView {
  @ApiProperty({ type: ReplayedDeliveryView, isArray: true }) requeued!: ReplayedDeliveryView[];

  @ApiProperty({ description: 'Matching deliveries left out because the limit was reached.' })
  skipped!: number;
}
