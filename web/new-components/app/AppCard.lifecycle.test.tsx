import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { IApp } from '@/types/app';

const state = vi.hoisted(() => ({ push: vi.fn(), create: vi.fn(), binding: vi.fn(), agent: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('next/image', () => ({ default: (props: any) => <img alt={props.alt} /> }));
vi.mock('@/app/chat-context', async () => {
  const { createContext } = await import('react');
  return { ChatContext: createContext({ model: 'fixture-model', setCurrentDialogInfo: state.binding, setAgent: state.agent }) };
});
vi.mock('@/client/api', () => ({
  newDialogue: state.create,
  apiInterceptors: async () => [null, { conv_uid: 'new-persisted-id' }],
}));
import AppCard from './AppCard';

describe('application conversation lifecycle', () => {
  it.each(['native_app', 'auto_plan'])('keeps scene and app identity for %s', async mode => {
    const app: IApp = {
      app_code: 'fixture-app', app_name: 'Fixture App', app_describe: 'Fixture',
      team_mode: mode, team_context: { chat_scene: 'chat_normal' },
      language: 'en', is_collected: 'false', updated_at: '', hot_value: 0, param_need: [],
    };
    render(<AppCard data={app} />);
    fireEvent.click(screen.getByText('Fixture App'));
    const expectedMode = mode === 'native_app' ? 'chat_normal' : 'chat_agent';
    await waitFor(() => expect(state.push).toHaveBeenCalled());
    expect(state.create).toHaveBeenCalledWith({ chat_mode: expectedMode, app_code: 'fixture-app' });
    expect(state.binding).toHaveBeenCalledWith({ chat_scene: expectedMode, app_code: 'fixture-app' });
    expect(JSON.parse(localStorage.getItem('cur_dialog_info')!)).toEqual({ chat_scene: expectedMode, app_code: 'fixture-app' });
    expect(state.push.mock.calls.at(-1)![0]).toContain('id=new-persisted-id');
  });
});
