import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { useContext } from 'react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Chat, { ChatContentContext } from './index';

const fixture = vi.hoisted(() => ({
  query: { id: 'native-app', scene: 'chat_normal', model: 'qwen3.5-plus-2026-02-15' } as Record<string, string>,
  chat: vi.fn(), replace: vi.fn(), history: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/chat', asPath: '/chat', query: fixture.query, replace: fixture.replace }) }));
vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams(fixture.query) }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));
vi.mock('@/app/chat-context', async () => ({
  ChatContext: (await import('react')).createContext({ model: 'global-default', currentDialogInfo: { chat_scene: 'chat_normal', app_code: 'fixture-app' }, setIsContract: () => {}, setIsMenuExpand: () => {} }),
}));
vi.mock('@/hooks/use-chat', () => ({ default: () => ({ chat: fixture.chat, ctrl: {}, contextStatus: null }) }));
vi.mock('@/utils', () => ({ getInitMessage: () => null, transformFileUrl: (value: string) => value }));
vi.mock('@/client/api', () => ({
  apiInterceptors: async (request: Promise<unknown>) => [null, await request],
  getAppInfo: async () => ({ app_code: 'fixture-app', param_need: [{ type: 'model', value: 'app-default' }] }),
  getDialogueList: async () => [{ conv_uid: 'native-app', app_code: 'fixture-app' }],
  getChatHistory: (id: string) => fixture.history(id),
}));
vi.mock('@/new-components/chat/sider/ChatSider', () => ({ default: () => null }));
vi.mock('@/components/common/prompt-bot', () => ({ default: () => null }));
vi.mock('@/new-components/chat/content/ChatDefault', () => ({ default: () => null }));
vi.mock('@/new-components/chat/content/QuestionDock', () => ({ default: () => null }));
vi.mock('@/new-components/chat/ChatContentContainer', async () => ({ default: (await import('react')).forwardRef(() => null) }));
vi.mock('@/new-components/chat/input/ChatInputPanel', async () => ({ default: (await import('react')).forwardRef(() => <Controls />) }));

function Controls() {
  const chat = useContext(ChatContentContext);
  return <>
    <output>{chat.modelValue}</output>
    <button onClick={() => chat.setModelValue('qwen3.5-plus-2026-04-20')}>Select April</button>
    <button onClick={() => chat.refreshAppInfo()}>Refresh App</button>
    <button onClick={() => void chat.handleChat('2+3', { app_code: 'fixture-app' })}>Send</button>
    <pre data-testid='history'>{JSON.stringify(chat.history)}</pre>
  </>;
}

beforeEach(() => {
  fixture.query = { id: 'native-app', scene: 'chat_normal', model: 'qwen3.5-plus-2026-02-15' };
  fixture.replace.mockReset().mockResolvedValue(true);
  fixture.chat.mockReset().mockImplementation(({ onDone }) => onDone());
  fixture.history.mockReset().mockResolvedValue([{ role: 'view', context: 'previous answer', order: 1, model_name: 'historical-model' }]);
});

it('ignores a late history response from the previous conversation when recovering a model', async () => {
  delete fixture.query.model;
  let completeOld!: (value: unknown) => void;
  fixture.history.mockImplementation((id: string) => id === 'native-app'
    ? new Promise(resolve => { completeOld = resolve; })
    : Promise.resolve([{ role: 'view', context: 'new conversation', order: 1, model_name: 'new-history-model' }]));
  const view = render(<Chat />);
  await waitFor(() => expect(fixture.history).toHaveBeenCalledWith('native-app'));
  fixture.query = { id: 'other-app-chat', scene: 'chat_normal' };
  view.rerender(<Chat />);
  await screen.findByText('new-history-model');
  await act(async () => completeOld([{ role: 'view', context: 'stale response', order: 1, model_name: 'stale-model' }]));
  expect(screen.getByText('new-history-model')).toBeTruthy();
  expect(screen.getByTestId('history').textContent).not.toContain('stale response');
});
afterEach(cleanup);

it('uses the selected model for the native App request and new round, without rewriting old history or reverting after App refresh', async () => {
  render(<Chat />);
  await waitFor(() => expect(screen.getByTestId('history').textContent).toContain('historical-model'));
  fireEvent.click(screen.getByText('Select April'));
  fireEvent.click(screen.getByText('Refresh App'));
  await waitFor(() => expect(screen.getByText('qwen3.5-plus-2026-04-20')).toBeTruthy());
  fireEvent.click(screen.getByText('Send'));
  await waitFor(() => expect(fixture.chat).toHaveBeenCalledTimes(1));
  expect(fixture.chat.mock.calls[0][0].data).toMatchObject({ model_name: 'qwen3.5-plus-2026-04-20', app_code: 'fixture-app', user_input: '2+3' });
  expect(fixture.replace.mock.calls[0][0].query).toMatchObject({ id: 'native-app', scene: 'chat_normal', model: 'qwen3.5-plus-2026-04-20' });
  const history = JSON.parse(screen.getByTestId('history').textContent!);
  expect(history[0].model_name).toBe('historical-model');
  expect(history.slice(1).map((item: { model_name: string }) => item.model_name)).toEqual(['qwen3.5-plus-2026-04-20', 'qwen3.5-plus-2026-04-20']);
});
