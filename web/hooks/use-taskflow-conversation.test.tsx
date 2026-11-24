import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EditingSnapshot, GenerationSession } from '@/types/taskflow-generation';
import { useTaskflowConversation } from './use-taskflow-conversation';
import { StrictMode, type ReactNode } from 'react';

const api = vi.hoisted(() => vi.fn());
vi.mock('@/client/api/taskflow-generation', () => ({ generationApi: api }));
vi.mock('@/app/i18n', () => ({ default: { t: (_k: string, o: any) => o.defaultValue } }));
const snapshot = { dsl: { nodes: [], edges: [], version: 'taskflow/1' }, meta: { label: 'Test' } } as unknown as EditingSnapshot;
const session = (id = 'S'): GenerationSession => ({
  session_id: id, snapshot, draft_revision: 1, context_revision: 1,
  requests: {}, candidate: null, messages: [], questions: [], undo: null, run: null, dirty: false,
});
beforeEach(() => { api.mockReset(); localStorage.clear(); api.mockResolvedValue(session()); });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

it('does not replace local edits that arrived while initialization was pending', async () => {
  let resolve!: (s: GenerationSession) => void;
  api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const onSnapshot = vi.fn();
  const view = renderHook(({ data }) => useTaskflowConversation(data, true, 'flow:A', onSnapshot), { initialProps: { data: snapshot } });
  view.rerender({ data: { ...snapshot, meta: { label: 'User edited' } } });
  await act(async () => resolve(session()));
  expect(onSnapshot).not.toHaveBeenCalled();
});

it('does not accept the previous flow response after switching flow', async () => {
  let resolve!: (s: GenerationSession) => void;
  api.mockImplementationOnce(() => new Promise(r => { resolve = r; }));
  const onSnapshot = vi.fn();
  const view = renderHook(({ key }) => useTaskflowConversation(snapshot, true, key, onSnapshot), { initialProps: { key: 'flow:A' } });
  api.mockResolvedValue(session('B'));
  view.rerender({ key: 'flow:B' });
  await waitFor(() => expect(view.result.current.session?.session_id).toBe('B'));
  await act(async () => resolve(session('A')));
  expect(view.result.current.session?.session_id).toBe('B');
  expect(onSnapshot).not.toHaveBeenCalledWith(expect.objectContaining({ meta: { label: 'A' } }));
});

it('keeps a session usable when browser persistence is blocked', async () => {
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('blocked'); });
  const view = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()));
  await waitFor(() => expect(view.result.current.session?.session_id).toBe('S'));
  expect(view.result.current.error).toBeNull();
});

it('initializes correctly through StrictMode effect replay', async () => {
  const view = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()), {
    wrapper: ({ children }: { children: ReactNode }) => <StrictMode>{children}</StrictMode>,
  });
  await waitFor(() => expect(view.result.current.session?.session_id).toBe('S'));
  expect(view.result.current.error).toBeNull();
  expect(api).toHaveBeenCalledOnce();
});

it('does not issue undefined candidate or cancel request URLs', async () => {
  const view = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()));
  await waitFor(() => expect(view.result.current.session).not.toBeNull());
  api.mockClear();
  await act(async () => { await view.result.current.action('cancel'); await view.result.current.action('apply'); });
  expect(api).not.toHaveBeenCalled();
});

it.each([{ status: 403 }, { status: 200, code: 'NOT_FOUND' }])('stops polling on permanent failure %j without resubmitting generation', async detail => {
  const active = session(); active.requests.R = { request_id: 'R', status: 'running' };
  api.mockResolvedValueOnce(active).mockRejectedValue(Object.assign(new Error('Forbidden'), detail));
  const view = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()));
  await waitFor(() => expect(view.result.current.error).toBe('Forbidden'));
  expect(view.result.current.busy).toBe(false);
  expect(api.mock.calls.map(call => call[0])).toEqual(['', '/S']);
});

it('restores only a missing saved session; permission errors do not create replacements', async () => {
  localStorage.setItem('flow:A', 'old');
  api.mockRejectedValueOnce(Object.assign(new Error('Not found'), { status: 404 })).mockResolvedValue(session('new'));
  const view = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()));
  await waitFor(() => expect(view.result.current.session?.session_id).toBe('new'));
  view.unmount(); api.mockReset();
  localStorage.setItem('flow:A', 'protected');
  api.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  const denied = renderHook(() => useTaskflowConversation(snapshot, true, 'flow:A', vi.fn()));
  await waitFor(() => expect(denied.result.current.error).toBe('Forbidden'));
  expect(api).toHaveBeenCalledOnce();
});
