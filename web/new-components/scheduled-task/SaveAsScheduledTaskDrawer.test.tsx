import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { describe, expect, it, vi } from 'vitest';
import SaveAsScheduledTaskDrawer from './SaveAsScheduledTaskDrawer';
const mocks = vi.hoisted(() => ({ createTask: vi.fn(), push: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: mocks.push }) }));
vi.mock('@/hooks/use-connector-api', () => ({ useConnectors: () => ({ connectors: [] }) }));
vi.mock('@/hooks/use-scheduled-task', () => ({ useScheduledTask: () => ({ createTask: mocks.createTask }) }));
vi.mock('react-i18next', async importOriginal => ({
  ...await importOriginal<typeof import('react-i18next')>(),
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('save current dashboard as an official scheduled task', () => {
  const dashboard = { dashboard_id: 'board-1', title: 'Sales', filters: { year: 2026 } };
  it('saves pending dashboard edits before creation, then offers real task history', async () => {
    const events: string[] = [];
    const onClose = vi.fn();
    mocks.createTask.mockImplementation(async () => {
      events.push('create');
      return { task_id: 'task-1', next_run_time: '2026-09-23T09:00:00+08:00' };
    });
    render(
      <SaveAsScheduledTaskDrawer
        open
        onClose={onClose}
        defaultName='Sales task'
        dashboard={dashboard}
        beforeCreate={async () => {
          events.push('save');
        }}
      />,
      { wrapper: App },
    );
    fireEvent.click(screen.getByText('scheduled.save.submit'));
    await screen.findByText('Scheduled task created');
    expect(events).toEqual(['save', 'create']);
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({
        task_type: 'dashboard_refresh',
        task_name: 'Sales task',
        cron_expression: '0 9 * * *',
        payload: { dashboard_id: 'board-1', filters: { year: 2026 }, publish_after_refresh: false },
      }),
    );
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('View task and execution history'));
    expect(mocks.push).toHaveBeenCalledWith('/construct/scheduled-tasks/task-1/');
  });
  it('does not schedule stale data when saving the dashboard fails', async () => {
    render(
      <SaveAsScheduledTaskDrawer
        open
        onClose={vi.fn()}
        defaultName='Sales task'
        dashboard={dashboard}
        beforeCreate={async () => {
          throw new Error('Revision conflict');
        }}
      />,
      { wrapper: App },
    );
    fireEvent.click(screen.getByText('scheduled.save.submit'));
    await screen.findByText('Revision conflict');
    expect(mocks.createTask).not.toHaveBeenCalled();
    expect(screen.queryByText('Scheduled task created')).toBeNull();
  });
  it('keeps chat snapshot creation working', async () => {
    const onClose = vi.fn();
    const snapshot = { user_input: 'Daily sales', model_name: 'model-1', ext_info: { skill_id: 'sql' } };
    mocks.createTask.mockResolvedValue({ task_id: 'chat-1' });
    render(<SaveAsScheduledTaskDrawer open onClose={onClose} snapshot={snapshot} />, { wrapper: App });
    fireEvent.click(screen.getByText('scheduled.save.submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.createTask).toHaveBeenCalledWith(
      expect.objectContaining({ task_type: 'chat_replay', payload: snapshot }),
    );
  });
  it('saves an edited standalone question while retaining datasource context', async () => {
    const onClose = vi.fn();
    const snapshot = { user_input: 'Compare that month', ext_info: { database_name: 'demo' } };
    mocks.createTask.mockResolvedValue({ task_id: 'chat-2' });
    render(<SaveAsScheduledTaskDrawer open onClose={onClose} snapshot={snapshot} />, { wrapper: App });
    fireEvent.change(screen.getByLabelText('Scheduled analysis request'), { target: { value: 'Compare December with November for facebook' } });
    fireEvent.click(screen.getByText('scheduled.save.submit'));
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(mocks.createTask).toHaveBeenCalledWith(expect.objectContaining({
      payload: { ...snapshot, user_input: 'Compare December with November for facebook' },
    }));
  });
});
