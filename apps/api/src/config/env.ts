/**
 * Minimal environment parsing with precise error messages.
 *
 * Configuration failures should stop the process at boot with a message naming the variable,
 * rather than surfacing as `undefined` deep inside a request. Every reader collects its own
 * complaint so one boot reports every problem at once.
 */
export class EnvironmentError extends Error {
  constructor(readonly problems: readonly string[]) {
    super(`Invalid environment configuration:\n- ${problems.join('\n- ')}`);
    this.name = 'EnvironmentError';
  }
}

export class EnvironmentReader {
  private readonly problems: string[] = [];

  constructor(private readonly source: NodeJS.ProcessEnv) {}

  string(key: string, fallback?: string): string {
    const raw = this.source[key]?.trim();
    if (raw) return raw;
    if (fallback !== undefined) return fallback;
    this.problems.push(`${key} is required`);
    return '';
  }

  integer(
    key: string,
    fallback: number,
    { min, max }: { min?: number; max?: number } = {},
  ): number {
    const raw = this.source[key]?.trim();
    if (!raw) return fallback;
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      this.problems.push(`${key} must be an integer, received "${raw}"`);
      return fallback;
    }
    if (min !== undefined && value < min) {
      this.problems.push(`${key} must be at least ${min}, received ${value}`);
      return fallback;
    }
    if (max !== undefined && value > max) {
      this.problems.push(`${key} must be at most ${max}, received ${value}`);
      return fallback;
    }
    return value;
  }

  boolean(key: string, fallback: boolean): boolean {
    const raw = this.source[key]?.trim().toLowerCase();
    if (!raw) return fallback;
    if (['true', '1', 'yes'].includes(raw)) return true;
    if (['false', '0', 'no'].includes(raw)) return false;
    this.problems.push(`${key} must be a boolean, received "${raw}"`);
    return fallback;
  }

  oneOf<const T extends readonly string[]>(
    key: string,
    allowed: T,
    fallback: T[number],
  ): T[number] {
    const raw = this.source[key]?.trim();
    if (!raw) return fallback;
    if (!allowed.includes(raw)) {
      this.problems.push(`${key} must be one of ${allowed.join(', ')}, received "${raw}"`);
      return fallback;
    }
    return raw as T[number];
  }

  assertValid(): void {
    if (this.problems.length > 0) throw new EnvironmentError(this.problems);
  }
}
