import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { useStreamState } from './use-stream-state';

afterEach(() => vi.useRealTimers());
it('coalesces bursts, preserves order and flushes terminal updates', () => {
  vi.useFakeTimers();
  const { result } = renderHook(() => useStreamState(0));
  act(() => { for (let i = 0; i < 100; i++) result.current[1](n => n + 1); });
  expect(result.current[0]).toBe(0);
  act(() => vi.advanceTimersByTime(40));
  expect(result.current[0]).toBe(100);
  act(() => { result.current[1](0); result.current[1](n => n + 2); result.current[2](); });
  expect(result.current[0]).toBe(2);
  act(() => vi.runAllTimers());
  expect(result.current[0]).toBe(2);
});
it('cancels outstanding work on unmount', () => {
  vi.useFakeTimers();
  const { result, unmount } = renderHook(() => useStreamState(0));
  act(() => result.current[1](1));
  unmount();
  expect(vi.getTimerCount()).toBe(0);
});
