import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { conversationTokenTotal, useConversationContext, useConversationTokens } from './use-conversation-meters';

const api = vi.hoisted(() => ({ owner: 'analyst', read: vi.fn() }));
vi.mock('@/utils/storage', () => ({ getUserId: () => api.owner }));
vi.mock('@/client/api', () => ({
  getConversationUsage: async (id: string) => {
    const [error, data] = await api.read(id);
    if (error) throw error;
    return { data: { success: !!data, data } };
  },
  apiInterceptors: () => { throw new Error('Background meters must not use notification interceptors'); },
}));
const measurement = {
  state: 'OK' as const, used_tokens: 200, max_tokens: 1000, usage_percent: 20,
  layer: null, model: 'model-a', context_window: 1200, reserved_tokens: 200, window_source: 'fallback',
};
const complete = (model: string, total: number) => ({
  model, calls: 1, complete: true, total_tokens: total, prompt_tokens: total - 1, completion_tokens: 1,
});
beforeEach(() => { localStorage.clear(); api.owner = 'analyst'; api.read.mockReset(); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

const history = (snapshots: Record<string, unknown>) => [{ role: 'view', context: JSON.stringify({ type: 'react-agent', version: 2, context_snapshots: snapshots }) }];
const saved = { ...measurement, measured_at: 1770000000000 };

it('restores server history on a fresh browser without reading context from localStorage', () => {
  localStorage.setItem('dbgpt-context-v1:old', JSON.stringify({ ...saved, used_tokens: 999 }));
  const first = renderHook(() => useConversationContext('chat', 'model-a'));
  expect(first.result.current.contextStatus).toBeNull();
  act(() => first.result.current.restoreContextHistory(history({ 'model-a': saved }), 'chat'));
  expect(first.result.current.contextStatus).toMatchObject({ ...saved, previous: true });
  first.unmount();
  localStorage.clear();
  const second = renderHook(() => useConversationContext('chat', 'model-a'));
  act(() => second.result.current.restoreContextHistory(history({ 'model-a': saved }), 'chat'));
  expect(second.result.current.contextStatus?.used_tokens).toBe(200);
  act(() => second.result.current.setContextStatus({ ...saved, measured_at: saved.measured_at + 10, used_tokens: 300 }));
  expect(second.result.current.contextStatus).toMatchObject({ used_tokens: 300, previous: false });
  act(() => second.result.current.markPrevious());
  expect(second.result.current.contextStatus?.previous).toBe(true);
});

it('restores each model and isolates another owner or conversation', () => {
  const hook = renderHook(({ conv, model }) => useConversationContext(conv, model), { initialProps: { conv: 'chat', model: 'model-a' } });
  act(() => hook.result.current.restoreContextHistory(history({ 'model-a': saved, 'model-b': { ...saved, model: 'model-b', used_tokens: 50 } }), 'chat'));
  hook.rerender({ conv: 'chat', model: 'model-b' });
  expect(hook.result.current.contextStatus?.used_tokens).toBe(50);
  hook.rerender({ conv: 'chat', model: 'unknown' });
  expect(hook.result.current.contextStatus).toBeNull();
  hook.rerender({ conv: 'chat', model: 'model-a' });
  expect(hook.result.current.contextStatus?.used_tokens).toBe(200);
  hook.rerender({ conv: 'other', model: 'model-a' });
  expect(hook.result.current.contextStatus).toBeNull();
  api.owner = 'admin';
  hook.rerender({ conv: 'chat', model: 'model-a' });
  expect(hook.result.current.contextStatus).toBeNull();
});

it('chooses the newest valid snapshot across turns, regardless of history array order', () => {
  const hook = renderHook(() => useConversationContext('chat', 'model-a'));
  const messages = [
    ...history({ 'model-a': { ...saved, measured_at: saved.measured_at + 20, used_tokens: 400 } }),
    ...history({ 'model-a': saved }),
    { role: 'human', context: JSON.stringify({ type: 'react-agent', context_snapshots: { 'model-a': { ...saved, used_tokens: 999 } } }) },
    ...history({ 'model-a': { ...saved, max_tokens: 0, measured_at: saved.measured_at + 30 } }),
    { role: 'view', context: 'old plain answer' },
  ];
  act(() => hook.result.current.restoreContextHistory(messages, 'chat'));
  expect(hook.result.current.contextStatus?.used_tokens).toBe(400);
});

it('does not replace a newer live measurement with an older history response', () => {
  const hook = renderHook(() => useConversationContext('chat', 'model-a'));
  act(() => hook.result.current.setContextStatus({ ...saved, measured_at: saved.measured_at + 50, used_tokens: 500 }));
  act(() => hook.result.current.restoreContextHistory(history({ 'model-a': saved }), 'chat'));
  expect(hook.result.current.contextStatus).toMatchObject({ used_tokens: 500, previous: false });
});

it('supports first-stream binding and ignores callbacks belonging to a previous conversation', () => {
  const hook = renderHook(({ conv }: { conv: string | null }) => useConversationContext(conv, 'model-a'), { initialProps: { conv: null } as { conv: string | null } });
  act(() => hook.result.current.setContextStatus(saved, { conversationId: 'new', model: 'model-a' }));
  hook.rerender({ conv: 'new' });
  expect(hook.result.current.contextStatus?.used_tokens).toBe(200);
  const oldSetter = hook.result.current.setContextStatus;
  const oldRestore = hook.result.current.restoreContextHistory;
  hook.rerender({ conv: 'another' });
  act(() => hook.result.current.setContextStatus({ ...saved, used_tokens: 42 }));
  act(() => oldSetter(saved, { conversationId: 'new', model: 'model-a' }));
  act(() => oldRestore(history({ 'model-a': saved }), 'new'));
  expect(hook.result.current.contextStatus?.used_tokens).toBe(42);
});

it('old histories without snapshots and invalid data remain unknown without writing localStorage', () => {
  const store = vi.spyOn(Storage.prototype, 'setItem');
  const hook = renderHook(() => useConversationContext('chat', 'model-a'));
  act(() => hook.result.current.restoreContextHistory([{ role: 'view', context: '{bad' }], 'chat'));
  expect(hook.result.current.contextStatus).toBeNull();
  act(() => hook.result.current.setContextStatus({ ...saved, max_tokens: 0 }));
  act(() => hook.result.current.setContextStatus({ ...saved, model: 'wrong' }));
  expect(hook.result.current.contextStatus).toBeNull();
  act(() => hook.result.current.setContextStatus(saved));
  expect(store).not.toHaveBeenCalled();
});

it('sums provider aggregates across models without deriving missing usage or context', () => {
  expect(conversationTokenTotal({ source: 'provider', models: [complete('a', 100), complete('b', 200)] }))
    .toEqual({ total: 300, complete: true, calls: 2 });
  expect(conversationTokenTotal({ source: 'provider', models: [complete('a', 100), {
    model: 'b', calls: 2, complete: false, total_tokens: null, prompt_tokens: null, completion_tokens: null,
    known_total_tokens: 50, reported_calls: 1,
  }] })).toEqual({ total: 150, complete: false, calls: 3 });
  expect(conversationTokenTotal({ source: 'provider', models: [] }).total).toBeNull();
  expect(conversationTokenTotal({ source: 'provider', models: [{ ...complete('a', 0), complete: false, total_tokens: null, known_total_tokens: 0, reported_calls: 0 }] }).total).toBeNull();
  expect(conversationTokenTotal({ source: 'provider', models: [complete('a', 0)] })).toEqual({ total: 0, complete: true, calls: 1 });
});

it('reloads the server aggregate and replaces it on follow-up instead of adding it twice', async () => {
  api.read.mockResolvedValue([null, { source: 'provider', models: [complete('a', 100)] }]);
  const first = renderHook(({ running }) => useConversationTokens('chat', running), { initialProps: { running: false } });
  await waitFor(() => expect(first.result.current.total).toBe(100));
  api.read.mockResolvedValue([null, { source: 'provider', models: [complete('a', 170), complete('b', 30)] }]);
  first.rerender({ running: true });
  await waitFor(() => expect(first.result.current.total).toBe(200));
  first.unmount();
  const reload = renderHook(() => useConversationTokens('chat', false));
  await waitFor(() => expect(reload.result.current.total).toBe(200));
});

it('ignores a late response from another conversation and reports API failures as unknown', async () => {
  let resolveOld!: (value: unknown) => void;
  api.read.mockImplementation((id: string) => id === 'old' ? new Promise(resolve => { resolveOld = resolve; }) : Promise.resolve([new Error('401'), null]));
  const hook = renderHook(({ conv }) => useConversationTokens(conv, false), { initialProps: { conv: 'old' } });
  hook.rerender({ conv: 'new' });
  await waitFor(() => expect(hook.result.current.failed).toBe(true));
  await act(async () => resolveOld([null, { source: 'provider', models: [complete('a', 999)] }]));
  expect(hook.result.current.total).toBeNull();
});

it('polls while running and cleans up timers on unmount', async () => {
  vi.useFakeTimers();
  api.read.mockResolvedValue([null, { source: 'provider', models: [complete('a', 10)] }]);
  const hook = renderHook(() => useConversationTokens('chat', true));
  await act(async () => { await Promise.resolve(); });
  await act(async () => { vi.advanceTimersByTime(10000); });
  expect(api.read).toHaveBeenCalledTimes(2);
  hook.unmount();
  await act(async () => { vi.advanceTimersByTime(30000); });
  expect(api.read).toHaveBeenCalledTimes(2);
});

it('recovers from a first-turn 404 when conversation history becomes available', async () => {
  api.read.mockResolvedValueOnce([new Error('Conversation not found'), null])
    .mockResolvedValue([null, { source: 'provider', models: [complete('a', 42)] }]);
  const hook = renderHook(({ running }) => useConversationTokens('new-chat', running), { initialProps: { running: true } });
  await waitFor(() => expect(hook.result.current.failed).toBe(true));
  expect(hook.result.current.total).toBeNull();
  hook.rerender({ running: false });
  await waitFor(() => expect(hook.result.current.total).toBe(42));
  expect(hook.result.current.failed).toBe(false);
});
