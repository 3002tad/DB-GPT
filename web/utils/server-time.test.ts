import { afterEach, expect, it, vi } from 'vitest';
import moment from 'moment';
import dayjs from 'dayjs';
import { serverDate } from './server-time';

afterEach(() => vi.useRealTimers());

it.each(['2026-11-17 07:13:22', '2026-11-17T07:13:22'])('reads naive server time as UTC: %s', input => {
  expect(serverDate(input).toISOString()).toBe('2026-11-17T07:13:22.000Z');
});

it.each(['2026-11-17T07:13:22Z', '2026-11-17T14:13:22+07:00', '2026-11-17T02:13:22-05:00'])(
  'preserves the instant of explicit timezone %s', input => {
    expect(serverDate(input).toISOString()).toBe('2026-11-17T07:13:22.000Z');
  },
);

it('does not show a fresh record as seven hours old and formats in the browser timezone', () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-11-17T07:13:52Z'));
  const date = serverDate('2026-11-17 07:13:22');
  expect(moment(date).fromNow(true)).toBe(moment(new Date('2026-11-17T07:13:22Z')).fromNow(true));
  expect(Date.now() - date.getTime()).toBe(30_000);
  expect(dayjs(date).valueOf()).toBe(Date.parse('2026-11-17T07:13:22Z'));
  expect(dayjs(date).format('YYYY-MM-DD HH:mm:ss')).toBe(dayjs('2026-11-17T07:13:22Z').format('YYYY-MM-DD HH:mm:ss'));
  const displayed = date.toLocaleString('en-GB', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit' });
  expect(displayed).toBe('14:13');
});

it('compares mixed offset/naive execution times consistently', () => {
  expect(serverDate('2026-11-17T14:13:27+07:00').getTime() - serverDate('2026-11-17 07:13:22').getTime()).toBe(5000);
});

it('supports fractional database timestamps, epoch milliseconds and Date inputs', () => {
  expect(serverDate('2026-11-17 07:13:22.123456').toISOString()).toBe('2026-11-17T07:13:22.123Z');
  expect(serverDate('2026-11-17 07:13:22.1').toISOString()).toBe('2026-11-17T07:13:22.100Z');
  const original = new Date('2026-11-17T07:13:22Z');
  expect(serverDate(original)).not.toBe(original);
  expect(serverDate(original.getTime()).getTime()).toBe(original.getTime());
});

it('does not shift explicit offsets across a daylight-saving boundary', () => {
  const before = serverDate('2026-11-01T01:30:00-04:00');
  const after = serverDate('2026-11-01T01:30:00-05:00');
  expect(after.getTime() - before.getTime()).toBe(3_600_000);
});

it.each([null, undefined, '', 'not-a-date'])('keeps missing/invalid timestamps invalid: %s', value => {
  expect(Number.isNaN(serverDate(value).getTime())).toBe(true);
});
