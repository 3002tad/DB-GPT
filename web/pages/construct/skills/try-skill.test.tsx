import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ push: vi.fn().mockResolvedValue(true) }));
vi.mock('next/router', () => ({ useRouter: () => ({ push: state.push }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key, i18n: { language: 'vi' } }) }));
vi.mock('@/new-components/layout/Construct', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('@/new-components/common/MarkdownContext', () => ({ default: ({ children }: any) => <>{children}</> }));
vi.mock('@/utils/ctx-axios', () => ({ default: {
  get: vi.fn(async (url: string) => ({ success: true, data: url.endsWith('/list') ? [{
    id: 'fixture-id', name: 'csv-data-analysis', description: 'CSV fixture',
    type: 'official', file_path: '/fixture/SKILL.md', skill_type: 'data_analysis', tags: [],
  }] : {
    skill_name: 'csv-data-analysis', tree: { key: 'SKILL.md', title: 'SKILL.md' },
    raw_content: '# CSV fixture', content_type: 'markdown', metadata: {},
  } })),
} }));

import Skills from './index';

describe('skill detail try button', () => {
  it('opens the composer with the actual selected skill name', async () => {
    render(<Skills />);
    fireEvent.click(await screen.findByText('csv-data-analysis', { exact: true }));
    fireEvent.click(await screen.findByRole('button', { name: 'skills_try_btn' }));
    expect(state.push).toHaveBeenCalledOnce();
    expect(state.push).toHaveBeenCalledWith({ pathname: '/', query: { try_skill: 'csv-data-analysis' } });
  });
});
