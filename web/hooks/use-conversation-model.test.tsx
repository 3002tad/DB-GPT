import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { useConversationModel } from './use-conversation-model';
import { conversationModelFromHistory } from '@/utils/conversation-model';
import { useConversationContext } from './use-conversation-meters';

const route = vi.hoisted(() => ({
  pathname: '/chat', asPath: '/chat?id=one&scene=chat_normal&model=old#answer',
  query: { id: 'one', scene: 'chat_normal', model: 'old', db_name: 'source', app_code: 'app' } as Record<string, string>,
  replace: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => route }));
vi.mock('@/utils/storage', () => ({ getUserId: () => 'analyst' }));
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

it('restores a root Agent model and its server context after reload without rewriting the URL', () => {
  delete route.query.model;
  const messages = [{ role: 'view', order: 1, model_name: 'february', context: JSON.stringify({
    type: 'react-agent', context_snapshots: { february: {
      model: 'february', state: 'OK', used_tokens: 14600, max_tokens: 103616,
      usage_percent: 14, layer: null, measured_at: 100,
    } },
  }) }];
  const { result, rerender } = renderHook(({ loaded }) => {
    const selection = useConversationModel({ chatId: 'one', scene: 'react-agent',
      defaultModel: 'global', historyModel: loaded ? conversationModelFromHistory(messages) : '',
      availableModels: ['global', 'february', 'april'] });
    return { ...selection, ...useConversationContext('one', selection.modelValue) };
  }, { initialProps: { loaded: false } });
  act(() => result.current.restoreContextHistory(messages, 'one'));
  rerender({ loaded: true });
  expect(result.current.modelValue).toBe('february');
  expect(result.current.contextStatus).toMatchObject({ model: 'february', usage_percent: 14, previous: true });
  expect(route.replace).not.toHaveBeenCalled();
  act(() => result.current.setModelValue('april'));
  rerender({ loaded: true });
  expect(result.current.modelValue).toBe('april');
  expect(result.current.contextStatus).toBeNull();
});

it('waits for usable inventory, then falls back consistently if a historical model was removed', () => {
  delete route.query.model;
  const { result, rerender } = renderHook(({ availableModels }) => useConversationModel({
    ...initial, historyModel: 'removed-model', availableModels,
  }), { initialProps: { availableModels: [] as string[] } });
  expect(result.current.modelValue).toBe('removed-model');
  rerender({ availableModels: ['global', 'usable'] });
  expect(result.current.modelValue).toBe('global');
});

it('does not overwrite a manual root selection when history and model inventory arrive late', () => {
  delete route.query.model;
  const { result, rerender } = renderHook(({ historyModel, availableModels }) => useConversationModel({
    chatId: 'one', scene: 'react-agent', defaultModel: 'global', historyModel, availableModels,
  }), { initialProps: { historyModel: '', availableModels: [] as string[] } });
  act(() => result.current.setModelValue('april'));
  rerender({ historyModel: 'february', availableModels: ['global', 'february', 'april'] });
  expect(result.current.modelValue).toBe('april');
});
