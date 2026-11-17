import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import i18n from './i18n';
import { useUiText, uiText } from '@/hooks/use-ui-text';
import { useDatabaseCopy, parameterLabel } from '@/components/database/presentation';
import { dashboardText } from '@/new-components/dashboard/dashboard-i18n';
import dashboardEn from '@/locales/en/dashboard';
import { viUiText, translateDynamicVi } from '@/locales/vi/ui-text';
import { applicationLanguage, applicationModeText } from '@/utils/application-presentation';
import { localizeSuite } from '@/utils/suite-routing';
import { taskflowPhase, taskflowPlaceholder, taskflowTemplateText } from '@/utils/taskflow-presentation';
import type { SuiteItem } from '@/types/suite';
import SuiteReadme from '@/new-components/suites/SuiteReadme';

afterEach(async () => { cleanup(); await i18n.changeLanguage('vi'); });

const modules = [
  'components/database/connection-welcome.tsx', 'components/database/database-banner.tsx',
  'components/database/database-form.tsx', 'components/database/form-dialog.tsx',
  'pages/construct/database.tsx', 'components/taskflow/editor/ConversationPanel.tsx',
  'pages/taskflow/editor.tsx',
];

describe('Module localization regression', () => {
  it('translates datasource counts and advanced settings without matching arbitrary user content', () => {
    expect(uiText('vi', '', '1 connections for your business data.')).toBe('1 kết nối dữ liệu nghiệp vụ.');
    expect(uiText('vi', '', '27 types available')).toBe('27 loại khả dụng');
    expect(uiText('vi', '', '2 connections')).toBe('2 kết nối');
    expect(uiText('vi', '', 'Advanced settings · 4')).toBe('Thiết lập nâng cao · 4');
    expect(uiText('vi', '', 'my 2 connections project')).toBe('my 2 connections project');
    expect(i18n.t('ui_knowledge_general')).toBe('Tổng quát');
  });
  it('covers labels emitted by the actual workflow node manifest', () => {
    const manifest = readFileSync(join(process.cwd(), '../packages/dbgpt-serve/src/dbgpt_serve/flow/taskflow/nodes.py'), 'utf8');
    const missing = [...manifest.matchAll(/label_en="([^"\n]+)"/g)].map(m => m[1]).filter(label => !(label in viUiText));
    expect([...new Set(missing)]).toEqual([]);
    expect(taskflowPlaceholder('明确本节点要完成什么、输出什么', 'vi')).toBe('Mô tả mục tiêu và đầu ra của nút này');
    expect(taskflowPlaceholder('/my/custom.csv', 'vi')).toBe('/my/custom.csv');
  });

  it('registers the dashboard namespace in Vietnamese with interpolation preserved', () => {
    expect(i18n.t('发送需求', { ns: 'dashboard' })).toBe('Gửi yêu cầu');
    expect(dashboardText('已选风格：{{value0}}。请选择数据后发送需求。', { value0: 'User title' })).toContain('User title');
  });

  it('localizes only built-in workflow card presentation, retaining custom labels', () => {
    const template = { name: 'taskflow_db_analysis_template', isTemplate: true, label: 'Original', description: 'Original description' } as any;
    expect(taskflowTemplateText(template, 'vi').label).toBe('Phân tích cơ sở dữ liệu');
    expect(template.label).toBe('Original');
    expect(taskflowTemplateText({ ...template, isTemplate: false }, 'vi').label).toBe('Original');
  });
  it('covers literal bilingual strings across datasource and workflow entry components', () => {
    const missing = new Set<string>();
    for (const file of modules) {
      const source = readFileSync(join(process.cwd(), file), 'utf8');
      for (const pair of source.matchAll(/\b(?:copy|text|tr)\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*[,)]/g)) {
        const english = pair[2].replace(/\\'/g, "'");
        if (!(english in viUiText) && !translateDynamicVi(english)) missing.add(english);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('covers dashboard list/create routes and gallery controls', () => {
    const missing = new Set<string>();
    for (const file of ['pages/dashboards/index.tsx', 'pages/dashboards/new.tsx', 'pages/dashboards/[id].tsx',
      'new-components/dashboard/DashboardTemplateGallery.tsx', 'new-components/dashboard/DashboardTemplatePreview.tsx',
      'new-components/dashboard/DashboardTemplateLayoutPreview.tsx']) {
      for (const call of readFileSync(join(process.cwd(), file), 'utf8').matchAll(/\bdt\(\s*'((?:[^'\\]|\\.)*)'/g)) {
        const english = dashboardEn[call[1]];
        if (english && !(english in viUiText) && !translateDynamicVi(english)) missing.add(english);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('covers the entire Dashboard namespace, including long help and prompts', () => {
    const technical = new Set(['Source Han Sans', 'CNY', 'USD', 'SQL', 'JSON', 'HTML', 'Markdown', 'CSV', 'Excel', 'PNG', 'PDF', 'KPI']);
    const missing = Object.values(dashboardEn).filter(english => english.trim().length > 0 &&
      !technical.has(english) && !(english in viUiText) && !translateDynamicVi(english));
    expect([...new Set(missing)].sort()).toEqual([]);
  });

  it('keeps placeholders intact in Vietnamese module translations', () => {
    for (const [english, vi] of Object.entries(viUiText)) {
      const variables = (s: string) => [...s.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(m => m[1]).sort();
      expect(variables(vi), english).toEqual(variables(english));
    }
    expect(dashboardText('已选模板：{{name}}。请选择数据后发送需求。', { name: 'My business' })).toContain('My business');
  });

  it('switches datasource and workflow labels without remounting or changing user input', async () => {
    function Probe() {
      const { i18n: locale } = useTranslation();
      const { copy } = useDatabaseCopy(locale.language);
      const tr = useUiText();
      const [value, setValue] = useState('用户自己的内容');
      return <><button>{copy('数据源', 'Data sources')}</button><span>{tr('生成模型', 'Generation model')}</span>
        <input aria-label='user-input' value={value} onChange={e => setValue(e.target.value)} /></>;
    }
    render(<Probe />);
    expect(screen.getByRole('button', { name: 'Nguồn dữ liệu' })).toBeTruthy();
    expect(screen.getByText('Mô hình tạo luồng')).toBeTruthy();
    fireEvent.change(screen.getByRole('textbox'), { target: { value: 'My untouched SQL: SELECT 1' } });
    await act(async () => { await i18n.changeLanguage('en'); });
    expect(screen.getByRole('button', { name: 'Data sources' })).toBeTruthy();
    await act(async () => { await i18n.changeLanguage('vi'); });
    expect((screen.getByRole('textbox') as HTMLInputElement).value).toBe('My untouched SQL: SELECT 1');
    expect(parameterLabel({ param_name: 'password' } as any, 'vi')).toBe('Mật khẩu');
    expect(parameterLabel({ param_name: 'custom', label: 'Custom source' } as any, 'vi')).toBe('Custom source');
  });

  it('localizes bundled plugins without changing identity, prompts, bindings or source objects', () => {
    const source = { id: 1, version: '1.0.0', status: 'enabled', name: 'db-query', source: 'official', display: '智能取数',
      readme: '原文', readme_locales: { en: 'English README' },
      skill_details: [{ name: 'nl2sql-precision', display: '精准取数', description: '原始说明' }],
      manifest_snapshot: { description: '原始说明', commands: [{ name: '/nl2sql', skill: 'nl2sql-precision', prefill: 'SELECT original' }],
        context_defaults: { datasource: 'funnelmetry_handoff' } } } as SuiteItem;
    const original = JSON.stringify(source);
    const vi = localizeSuite(source, 'vi-VN');
    expect(vi.display).toBe('Truy vấn dữ liệu');
    expect(vi.skill_details?.[0].display).toBe('Tạo SQL chính xác');
    expect(vi.readme).toBe('English README');
    expect(vi.manifest_snapshot?.commands?.[0]).toMatchObject({ name: '/nl2sql', skill: 'nl2sql-precision', prefill: 'SELECT original' });
    expect(vi.manifest_snapshot?.context_defaults).toEqual(source.manifest_snapshot?.context_defaults);
    expect(JSON.stringify(source)).toBe(original);
    expect(localizeSuite(source, 'zh').display).toBe('智能取数');
    expect(localizeSuite({ ...source, source: 'enterprise' }, 'vi').display).toBe('智能取数');
  });

  it('keeps original unlocalized package documentation available behind a disclosure', () => {
    render(<SuiteReadme label='README'>原始文档内容</SuiteReadme>);
    expect(screen.getByText('Tài liệu gốc').closest('details')?.open).toBe(false);
    expect(screen.getByText('原始文档内容')).toBeTruthy();
  });

  it('uses locale for new app language and translates known modes/phases only', () => {
    expect(applicationLanguage('vi-VN')).toBe('en');
    expect(applicationModeText({ value: 'single_agent' } as any, 'vi')).toBe('Một Agent');
    expect(taskflowPhase('构建流程', 'vi')).toBe('Đang tạo luồng');
    expect(taskflowPhase('Custom result 未知', 'vi')).toBe('Custom result 未知');
    expect(uiText('zh', '原文', 'Original')).toBe('原文');
  });
});
