import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('@/hooks/use-ui-text', () => ({ useUiText: () => (_zh: string, en: string) => en }));
vi.mock('@/new-components/skills/SkillPreview', () => ({ default: () => null }));

import DashboardDesignTemplate from './DashboardDesignTemplate';

it('opens the dashboard creation flow with the selected design', () => {
  render(<DashboardDesignTemplate name='pawspa-viz-design' favorite={false} onFavorite={() => {}} />);
  fireEvent.click(screen.getByRole('button', { name: /Use template/i }));
  expect(state.push).toHaveBeenCalledWith({
    pathname: '/dashboards/new',
    query: { design_skill: 'pawspa-viz-design' },
  });
});
