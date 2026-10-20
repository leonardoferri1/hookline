import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsDefined,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Delivery } from '../../deliveries/domain/delivery';
import { HooklineEvent } from '../domain/event';

export class PublishEventBody {
  @ApiProperty({ example: 'order.paid' })
  @IsString()
  @MaxLength(100)
  type!: string;

  @ApiProperty({
    example: { orderId: 'ord_1042', total: 12990, currency: 'BRL' },
    description: 'Arbitrary JSON object delivered verbatim to every subscriber.',
    type: Object,
  })
  @IsDefined()
  @IsObject()
  payload!: Record<string, unknown>;

  @ApiPropertyOptional({
    example: 'ord_1042',
    description: 'Events sharing a partition key are delivered in order to ordered endpoints.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  partitionKey?: string;

  @ApiPropertyOptional({ example: 'checkout-service', description: 'Free-form publisher label.' })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  source?: string;

  @ApiPropertyOptional({
    example: '2026-10-20T12:30:00.000Z',
    description: 'When the event happened. Defaults to the moment it was received.',
  })
  @IsOptional()
  @IsDateString()
  occurredAt?: string;
}

export class ListEventsQuery {
  @ApiPropertyOptional({ example: 'order.paid' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  type?: string;

  @ApiPropertyOptional({ example: 50, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @ApiPropertyOptional({ description: 'Return events created strictly before this timestamp.' })
  @IsOptional()
  @IsDateString()
  before?: string;
}

export class EventView {
  @ApiProperty() id!: string;
  @ApiProperty() type!: string;
  @ApiProperty({ type: Object }) payload!: unknown;
  @ApiProperty({ nullable: true, type: String }) partitionKey!: string | null;
  @ApiProperty({ nullable: true, type: String }) idempotencyKey!: string | null;
  @ApiProperty({ nullable: true, type: String }) source!: string | null;
  @ApiProperty() occurredAt!: string;
  @ApiProperty() createdAt!: string;

  static from(event: HooklineEvent): EventView {
    return {
      id: event.id,
      type: event.type,
      payload: event.payload,
      partitionKey: event.partitionKey,
      idempotencyKey: event.idempotencyKey,
      source: event.source,
      occurredAt: event.occurredAt.toISOString(),
      createdAt: event.createdAt.toISOString(),
    };
  }
}

export class QueuedDeliveryView {
  @ApiProperty() id!: string;
  @ApiProperty() endpointId!: string;
  @ApiProperty({ enum: ['pending', 'in_flight', 'succeeded', 'failed', 'canceled'] })
  state!: string;
  @ApiProperty() attemptCount!: number;
  @ApiProperty() maxAttempts!: number;
  @ApiProperty() nextAttemptAt!: string;

  static from(delivery: Delivery): QueuedDeliveryView {
    return {
      id: delivery.id,
      endpointId: delivery.endpointId,
      state: delivery.state,
      attemptCount: delivery.attemptCount,
      maxAttempts: delivery.maxAttempts,
      nextAttemptAt: delivery.nextAttemptAt.toISOString(),
    };
  }
}

export class PublishedEventView {
  @ApiProperty({ type: EventView }) event!: EventView;

  @ApiProperty({
    type: QueuedDeliveryView,
    isArray: true,
    description: 'One entry per subscribing endpoint. An empty list means nothing subscribes yet.',
  })
  deliveries!: QueuedDeliveryView[];

  @ApiProperty({
    description: 'True when an Idempotency-Key matched an event that had already been accepted.',
  })
  replayed!: boolean;

  static from(result: {
    event: HooklineEvent;
    deliveries: readonly Delivery[];
    replayed: boolean;
  }): PublishedEventView {
    return {
      event: EventView.from(result.event),
      deliveries: result.deliveries.map(QueuedDeliveryView.from),
      replayed: result.replayed,
    };
  }
}
