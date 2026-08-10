
import { createHash } from 'crypto';
import { logger } from '../../../utils/logger.js';

export function computeObservationContentHash(
  memorySessionId: string,
  title: string | null,
  narrative: string | null,
  suffix?: string
): string {
  return createHash('sha256')
    .update([memorySessionId || '', title || '', narrative || '', suffix || ''].join('\x00'))
    .digest('hex')
    .slice(0, 16);
}
