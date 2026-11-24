import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useChatFollowScroll } from './use-chat-follow-scroll';

afterEach(() => { vi.useRealTimers(); document.body.innerHTML = ''; });
it('does not follow while reading above, resumes at bottom and ignores unrelated scroll', () => {
  vi.useFakeTimers();
  const container = document.createElement('div');
  const end = document.createElement('div');
  const other = document.createElement('div');
  container.append(end); document.body.append(container, other);
  Object.defineProperties(container, {
    scrollHeight: { value: 1000 }, clientHeight: { value: 300 },
    scrollTop: { value: 700, writable: true },
  });
  end.scrollIntoView = vi.fn();
  const ref = { current: end };
  const { rerender } = renderHook(({ revision }) => useChatFollowScroll(ref, revision), { initialProps: { revision: 0 } });
  act(() => vi.advanceTimersByTime(20));
  expect(end.scrollIntoView).toHaveBeenCalledTimes(1);
  container.scrollTop = 0;
  act(() => container.dispatchEvent(new Event('scroll')));
  rerender({ revision: 1 }); act(() => vi.advanceTimersByTime(20));
  expect(end.scrollIntoView).toHaveBeenCalledTimes(1);
  container.scrollTop = 700;
  act(() => container.dispatchEvent(new Event('scroll')));
  act(() => other.dispatchEvent(new Event('scroll')));
  rerender({ revision: 2 }); act(() => vi.advanceTimersByTime(20));
  expect(end.scrollIntoView).toHaveBeenCalledTimes(2);
});
