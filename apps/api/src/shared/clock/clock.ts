/**
 * Time is injected rather than read from the global clock so retry schedules, lease expiry and
 * signature timestamps can be asserted in tests without sleeping.
 */
export abstract class Clock {
  abstract now(): Date;

  nowSeconds(): number {
    return Math.floor(this.now().getTime() / 1000);
  }
}

export class SystemClock extends Clock {
  override now(): Date {
    return new Date();
  }
}

export class FixedClock extends Clock {
  constructor(private current: Date) {
    super();
  }

  override now(): Date {
    return this.current;
  }

  advance(milliseconds: number): void {
    this.current = new Date(this.current.getTime() + milliseconds);
  }

  set(moment: Date): void {
    this.current = moment;
  }
}
