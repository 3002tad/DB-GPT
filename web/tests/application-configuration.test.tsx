import ExtraAppInfo from '@/pages/construct/app/extra';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  updateApp: vi.fn(),
  replace: vi.fn(),
  t: (key: string) => key,
}));
vi.mock('next/router', () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: mocks.t }) }));
// Keep the real AntD Form validation. Adapt only Select's popup, whose CSS
// selectors are unsupported by jsdom; browser acceptance remains separate.
vi.mock('antd', async importOriginal => {
  const original = await importOriginal<typeof import('antd')>();
  return {
    ...original,
    Select: ({ id, value, onChange, options = [], placeholder, disabled }: any) => (
      <select
        id={id}
        value={value || ''}
        disabled={disabled}
        onChange={event => onChange?.(event.target.value || undefined)}
      >
        <option value=''>{placeholder}</option>
        {options.map((option: any) => (
          <option key={option.value} value={option.value}>
            {option.scene_name || option.label}
          </option>
        ))}
      </select>
    ),
  };
});
vi.mock('@/client/api', () => ({
  apiInterceptors: (request: unknown) => request,
  updateApp: mocks.updateApp,
  getNativeAppScenes: () =>
    Promise.resolve([null, [{ chat_scene: 'chat_with_db_qa', scene_name: 'Chat DB', param_need: [] }]]),
  getAppStrategyValues: () => Promise.resolve([null, ['test-model']]),
  getPromptList: () => Promise.resolve([null, { items: [] }]),
  getResource: () => Promise.resolve([null, []]),
  getFlows: () => Promise.resolve([null, { items: [{ name: 'ready-flow', label: 'Ready flow', dag_id: 'dag-1' }] }]),
}));
vi.mock('@/new-components/common/AppDefaultIcon', () => ({ default: () => null }));
vi.mock('@/components/flow/preview-flow', () => ({ default: () => null }));
vi.mock('@/pages/construct/app/components/create-app-modal', () => ({ default: () => null }));
vi.mock('@/pages/construct/app/extra/components/auto-plan', () => ({ default: () => null }));
vi.mock('@/pages/construct/app/extra/components/auto-plan/PromptSelect', () => ({ default: () => null }));
vi.mock('@/pages/construct/app/extra/components/RecommendQuestions', () => ({ default: () => null }));

function openApp(team_mode: string, team_context = {}) {
  localStorage.setItem(
    'new_app_info',
    JSON.stringify({
      app_code: 'test-app',
      app_name: 'Test app',
      team_mode,
      team_context,
    }),
  );
  return render(
    <App>
      <ExtraAppInfo />
    </App>,
  );
}

async function save() {
  const button = screen.getByRole('button', { name: 'save' });
  await waitFor(() => expect(button.hasAttribute('disabled')).toBe(false));
  fireEvent.click(button);
}

describe('application save validates its configuration form', () => {
  beforeEach(() => {
    localStorage.clear();
    mocks.updateApp.mockResolvedValue([null, { app_code: 'test-app' }]);
  });

  it('shows a field error and sends no request when native scene is missing', async () => {
    openApp('native_app');
    await save();
    await screen.findByText('app_type_select', { selector: '.ant-form-item-explain-error' });
    expect(mocks.updateApp).not.toHaveBeenCalled();
    expect(mocks.replace).not.toHaveBeenCalled();
  });

  it('keeps a newly selected native scene through parent rerenders and saves it', async () => {
    openApp('native_app');
    await waitFor(() => expect(screen.getByLabelText('native_type')).toBeTruthy());
    await screen.findByText('Chat DB');
    fireEvent.change(screen.getByLabelText('native_type'), { target: { value: 'chat_with_db_qa' } });
    await save();
    await waitFor(() =>
      expect(mocks.updateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          team_context: { chat_scene: 'chat_with_db_qa', scene_name: 'Chat DB' },
        }),
      ),
    );
    await waitFor(() => expect(mocks.replace).toHaveBeenCalledWith('/construct/app'));
  });

  it('does not submit the previous workflow after it is cleared', async () => {
    openApp('awel_layout', { name: 'ready-flow', dag_id: 'dag-1' });
    await screen.findByText('Ready flow');
    await waitFor(() =>
      expect((screen.getByLabelText('select_workflow') as HTMLSelectElement).value).toBe('ready-flow'),
    );
    fireEvent.change(screen.getByLabelText('select_workflow'), { target: { value: '' } });
    await save();
    await screen.findByText('please_select_workflow', { selector: '.ant-form-item-explain-error' });
    expect(mocks.updateApp).not.toHaveBeenCalled();
  });

  it('preserves an existing valid workflow when saving', async () => {
    openApp('awel_layout', { name: 'ready-flow', dag_id: 'dag-1' });
    await screen.findByText('Ready flow');
    await save();
    await waitFor(() =>
      expect(mocks.updateApp).toHaveBeenCalledWith(
        expect.objectContaining({
          team_context: expect.objectContaining({ dag_id: 'dag-1' }),
        }),
      ),
    );
  });
});
