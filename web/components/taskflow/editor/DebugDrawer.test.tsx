import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import DebugDrawer from './DebugDrawer';

vi.mock('@/app/chat-context', async () => ({ ChatContext: (await import('react')).createContext({ model: 'M', modelList: ['M'] }) }));
vi.mock('@/app/i18n', () => ({ default: { t: (key: string) => key } }));
vi.mock('@/components/chat/header/model-selector', () => ({ renderModelIcon: () => null }));
vi.mock('@/new-components/common/MarkdownContext', () => ({ default: ({ children }: { children: ReactNode }) => <div>{children}</div> }));
vi.mock('@/new-components/chat/content/TaskflowAgentTrace', () => ({ default: () => null }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
// Test stream/lifecycle behavior; portal focus CSS needs a browser engine.
vi.mock('antd', async importOriginal => ({
  ...await importOriginal<typeof import('antd')>(),
  Select: () => null,
  Drawer: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
}));
afterEach(() => vi.unstubAllGlobals());

const base = { open: true, onClose: vi.fn(), buildPayload: () => ({}), dslNodes: [] };
function start() {
  fireEvent.change(screen.getByPlaceholderText('taskflow_debug_placeholder'), { target: { value: 'Question' } });
  fireEvent.click(screen.getByRole('button', { name: 'taskflow_run' }));
}

it('consumes the final event even without a trailing newline', async () => {
  const reader = { read: vi.fn()
    .mockResolvedValueOnce({ done: false, value: new TextEncoder().encode('data: {"text":"Answer"}\ndata: {"run_completed":true,"success":true}') })
    .mockResolvedValueOnce({ done: true }) };
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, body: { getReader: () => reader } }));
  render(<DebugDrawer {...base} prepareRun={async () => ({ sessionId: 'S', revision: 1 })} />);
  start();
  await screen.findByText('Answer');
  await screen.findByText('taskflow_flow_completed');
  expect(screen.queryByText('taskflow_run_incomplete')).toBeNull();
});

it('does not submit a run after closing during preparation', async () => {
  let resolve!: (v: { sessionId: string; revision: number }) => void;
  const prepare = vi.fn(() => new Promise<{ sessionId: string; revision: number }>(r => { resolve = r; }));
  const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
  const view = render(<DebugDrawer {...base} prepareRun={prepare} />);
  start();
  await waitFor(() => expect(prepare).toHaveBeenCalledOnce());
  view.rerender(<DebugDrawer {...base} open={false} prepareRun={prepare} />);
  await act(async () => resolve({ sessionId: 'S', revision: 1 }));
  expect(fetch).not.toHaveBeenCalled();
});
