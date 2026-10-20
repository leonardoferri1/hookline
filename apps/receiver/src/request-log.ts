import { SignatureFailureReason } from '@hookline/signature';

export interface ReceivedRequest {
  readonly sequence: number;
  readonly receivedAt: string;
  readonly path: string;
  readonly eventId: string | null;
  readonly eventType: string | null;
  readonly deliveryId: string | null;
  readonly attempt: number | null;
  readonly signature: 'valid' | 'invalid' | 'unchecked';
  readonly signatureReason: SignatureFailureReason | null;
  readonly statusReturned: number;
  readonly handledInMs: number;
  readonly bodyPreview: string;
}

/**
 * Bounded in-memory log, newest first.
 *
 * A test receiver that grows without limit becomes the thing that breaks during a demonstration,
 * so the log is a fixed-size ring and the stored body is truncated. Nothing here is persisted:
 * restarting the receiver is supposed to forget everything.
 */
export class RequestLog {
  private readonly entries: ReceivedRequest[] = [];
  private sequence = 0;

  constructor(
    private readonly capacity = 200,
    private readonly bodyPreviewBytes = 512,
  ) {}

  record(
    entry: Omit<ReceivedRequest, 'sequence' | 'bodyPreview'> & { body: string },
  ): ReceivedRequest {
    this.sequence += 1;
    const { body, ...rest } = entry;
    const recorded: ReceivedRequest = {
      ...rest,
      sequence: this.sequence,
      bodyPreview:
        body.length > this.bodyPreviewBytes ? `${body.slice(0, this.bodyPreviewBytes)}…` : body,
    };
    this.entries.unshift(recorded);
    if (this.entries.length > this.capacity) this.entries.length = this.capacity;
    return recorded;
  }

  list(limit = 50): ReceivedRequest[] {
    return this.entries.slice(0, Math.min(limit, this.capacity));
  }

  /** Count of requests seen since the last reset, which survives entries falling off the ring. */
  get total(): number {
    return this.sequence;
  }

  clear(): void {
    this.entries.length = 0;
    this.sequence = 0;
  }
}
