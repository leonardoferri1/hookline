import { ValidationError } from '../../../shared/errors/domain-error';

export const MAX_URL_LENGTH = 2048;

/**
 * Validates the shape of a destination before it is stored. This is deliberately not the full
 * safety check: whether the host resolves to a private address can change between now and the
 * next delivery, so that decision belongs to the sender, immediately before the request leaves.
 */
export function normalizeDestinationUrl(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length > MAX_URL_LENGTH)
    throw new ValidationError(`The destination URL must be at most ${MAX_URL_LENGTH} characters.`);

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new ValidationError('The destination URL is not a valid absolute URL.');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:')
    throw new ValidationError('The destination URL must use http or https.');
  if (url.username || url.password)
    throw new ValidationError('The destination URL must not embed credentials.');
  if (url.hash) throw new ValidationError('The destination URL must not contain a fragment.');
  if (!url.hostname) throw new ValidationError('The destination URL must include a host.');

  return url.toString();
}
