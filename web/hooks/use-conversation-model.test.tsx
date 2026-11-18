import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationModel } from './use-conversation-model';

const route = vi.hoisted(() => ({
  pathname: '/chat', asPath: '/chat?id=one&scene=chat_normal&model=old#answer',
  query: { id: 'one', scene: 'chat_normal', model: 'old', db_name: 'source', app_code: 'app' } as Record<string, string>,
  replace: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => route }));
beforeEach(() => {
  route.query = { id: 'one', scene: 'chat_normal', model: 'old', db_name: 'source', app_code: 'app' };
  route.replace.mockReset().mockResolvedValue(true);
});
afterEach(cleanup);
const initial = { chatId: 'one', scene: 'chat_normal', historyModel: 'historical', appModel: 'app-default', defaultModel: 'global' };

it('switches optimistically and replaces only the model, preserving conversation, source, App and hash', () => {
  const { result, rerender } = renderHook(props => useConversationModel(props), { initialProps: initial });
  expect(result.current.modelValue).toBe('old');
  act(() => result.current.setModelValue('new'));
  expect(result.current.modelValue).toBe('new');
  expect(route.replace).toHaveBeenCalledWith({ pathname: '/chat', query: { ...route.query, model: 'new' }, hash: '#answer' }, undefined, { shallow: true, scroll: false });
  rerender({ ...initial, appModel: 'refreshed-default', defaultModel: 'refreshed-global' });
  expect(result.current.modelValue).toBe('new');
  route.query = { ...route.query, model: 'new' };
  rerender(initial);
  expect(result.current.modelValue).toBe('new');
});

it('restores the URL choice after reload and follows browser navigation', () => {
  route.query.model = 'new';
  const { result, rerender } = renderHook(props => useConversationModel(props), { initialProps: initial });
  expect(result.current.modelValue).toBe('new');
  route.query.model = 'old';
  rerender(initial);
  expect(result.current.modelValue).toBe('old');
  route.query.model = 'new';
  rerender(initial);
  expect(result.current.modelValue).toBe('new');
  expect(route.replace).not.toHaveBeenCalled();
});

it('recovers the latest persisted model when no URL choice exists, before App/global defaults', () => {
  delete route.query.model;
  const { result, rerender } = renderHook(props => useConversationModel(props), { initialProps: { ...initial, historyModel: '' } });
  expect(result.current.modelValue).toBe('app-default');
  rerender(initial);
  expect(result.current.modelValue).toBe('historical');
  expect(route.replace).not.toHaveBeenCalled();
});

it('does not carry an uncommitted selection into a different conversation', () => {
  const { result, rerender } = renderHook(props => useConversationModel(props), { initialProps: initial });
  act(() => result.current.setModelValue('selected-for-one'));
  route.query = { id: 'two', scene: 'chat_normal' };
  rerender({ ...initial, chatId: 'two', historyModel: '' });
  expect(result.current.modelValue).toBe('app-default');
});

it('keeps a selection usable if URL navigation fails, without unhandled rejection', async () => {
  route.replace.mockRejectedValueOnce({ cancelled: true });
  const { result } = renderHook(() => useConversationModel(initial));
  await act(async () => result.current.setModelValue('selected'));
  expect(result.current.modelValue).toBe('selected');
});
