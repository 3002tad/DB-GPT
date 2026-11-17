/**
 * Parse DB-GPT operational timestamps. Legacy metadata APIs omit the offset
 * even though the deployed DB-GPT server/DB clock is UTC. Never use this for
 * analytical date columns, calendar filters or user-entered cron wall times.
 */
export function serverDate(value: string | number | Date | null | undefined): Date {
  if (value == null || value === '') return new Date(NaN);
  if (typeof value === 'string') {
    const timestamp = value.trim();
    const naive = /^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?$/.exec(timestamp);
    if (naive) {
      const fraction = naive[3] ? `.${naive[3].slice(0, 3).padEnd(3, '0')}` : '';
      return new Date(`${naive[1]}T${naive[2]}${fraction}Z`);
    }
    // Calendar-only values have no instant/timezone contract; do not reinterpret
    // them as metadata. Offset-bearing instants already specify their timezone.
    return new Date(timestamp);
  }
  return new Date(value instanceof Date ? value.getTime() : value);
}
