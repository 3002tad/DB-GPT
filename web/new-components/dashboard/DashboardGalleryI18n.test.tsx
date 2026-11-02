import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import SkillPreview from '../skills/SkillPreview';
import DashboardTemplateLayoutPreview from './DashboardTemplateLayoutPreview';
import DashboardGenerationCard from './DashboardGenerationCard';
import DashboardFilters from './DashboardFilters';
import DashboardThemePanel from './DashboardThemePanel';
import type { CatalogTemplate } from './dashboard-catalog';

const locale = vi.hoisted(() => ({ language: 'en' }));
vi.mock('@/hooks/use-ui-text', () => ({
  useUiText: () => (zh: string, en: string) => (locale.language === 'zh' ? zh : en),
}));

const template: CatalogTemplate = {
  id: 'retail-overview', title: '零售经营总览', category: '销售', description: '原始说明', sourceNames: [], prompt: '原始提示',
};

describe('dashboard preview localization', () => {
  beforeEach(() => { locale.language = 'en'; });

  it('renders English sample text without changing the template', () => {
    render(<DashboardTemplateLayoutPreview template={template} />);
    expect(screen.getByText('Retail overview')).toBeTruthy();
    expect(screen.getByText('Trend area')).toBeTruthy();
    expect(template.prompt).toBe('原始提示');
  });

  it('keeps Chinese for the Chinese locale', () => {
    locale.language = 'zh';
    render(<DashboardTemplateLayoutPreview template={template} />);
    expect(screen.getByText('零售经营总览')).toBeTruthy();
    expect(screen.getByText('趋势区域')).toBeTruthy();
  });

  it('localizes the example text inside skill previews', () => {
    render(<SkillPreview name='learnhub-viz-design' />);
    expect(screen.getByText('See every step')).toBeTruthy();
    expect(screen.getByText('Course progress')).toBeTruthy();
  });

  it('explains an incomplete generation in English without translating its data', () => {
    render(<DashboardGenerationCard state={{ status: 'failed', title: '用户看板', totalWidgets: 0, validatedWidgets: 0, failedWidgets: 0, widgetStates: {}, generationId: 'run' }} onOpen={() => {}} />);
    expect(screen.getByText('Generation did not finish. Saved plans and drafts are retained.')).toBeTruthy();
    expect(screen.getByText('用户看板')).toBeTruthy();
  });

  it('localizes filter controls while retaining the user-defined label', () => {
    render(<DashboardFilters filters={[{ id: 'q', type: 'text', label: 'Campaign', field: 'campaign', default: null, options: [] }]} values={{}} onChange={() => {}} />);
    expect(screen.getByRole('textbox', { name: 'Campaign filter' })).toBeTruthy();
    expect(screen.getByPlaceholderText('Enter a keyword; clear for all')).toBeTruthy();
  });

  it('renders localized theme controls in English and preserves theme identifiers', () => {
    const onChange = vi.fn();
    render(<DashboardThemePanel theme={{ preset: 'clarity', mode: 'light', overrides: {} }} onChange={onChange} />);
    expect(screen.getByRole('button', { name: 'Select Graphite theme' })).toBeTruthy();
    expect(screen.getByText('Visual theme')).toBeTruthy();
  });
});
