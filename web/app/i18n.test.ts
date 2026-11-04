import { describe, expect, it } from 'vitest';
import i18n from './i18n';
import { translateDynamicVi, viUiText } from '@/locales/vi/ui-text';
import vi from '@/locales/vi';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { localizeConnectorCatalog, localizeConnectorField } from '@/new-components/connector/catalog-i18n';
import { dashboardSourceLabel } from '@/new-components/dashboard/dashboard-source-label';
import { officialSkillDescription, skillDisplayDescription, skillMatchesSearch } from '@/new-components/skills/official-skill-descriptions';

describe('Vietnamese interface locale', () => {
  it('localizes bundled skill descriptions and preserves unknown or Chinese descriptions', () => {
    const original = '原始描述';
    for (const name of ['dashboard-chart-configuration', 'dashboard-collaboration', 'dashboard-filter-configuration']) {
      expect(officialSkillDescription(name, 'vi', original)).not.toMatch(/[\u4e00-\u9fff]/);
      expect(officialSkillDescription(name, 'en', original)).not.toMatch(/[\u4e00-\u9fff]/);
      expect(officialSkillDescription(name, 'zh', original)).toBe(original);
    }
    expect(officialSkillDescription('custom', 'vi', original)).toBe(original);
  });

  it('localizes and searches the skill picker without altering personal skills', () => {
    const official = { name: 'pawspa-viz-design', description: '原始描述', type: 'official' as const };
    const personal = { ...official, type: 'personal' as const };
    expect(skillDisplayDescription(official, 'vi')).toContain('thú cưng');
    expect(skillMatchesSearch(official, 'vi', 'thú cưng')).toBe(true);
    expect(skillMatchesSearch(official, 'vi', '原始')).toBe(true);
    expect(skillDisplayDescription(personal, 'vi')).toBe('原始描述');
    expect(skillMatchesSearch(personal, 'vi', 'thú cưng')).toBe(false);
  });
  it('defaults to Vietnamese and falls back to English for untranslated keys', async () => {
    expect(i18n.language).toBe('vi');
    expect(i18n.t('new_task')).toBe('Tác vụ mới');
    i18n.addResource('en', 'translation', '__fallback_test', 'English fallback');
    expect(i18n.t('__fallback_test')).toBe('English fallback');
  });

  it('keeps English and Chinese available', async () => {
    await i18n.changeLanguage('en');
    expect(i18n.t('cancel')).toBe('Cancel');
    await i18n.changeLanguage('zh');
    expect(i18n.t('cancel')).not.toBe('Cancel');
    await i18n.changeLanguage('vi');
  });

  it('provides Vietnamese for common dashboard actions', () => {
    expect(viUiText['Create dashboard']).toBe('Tạo bảng điều khiển');
    expect(viUiText['Configure SQL manually']).toBe('Tự cấu hình SQL');
  });

  it('translates supported dynamic dashboard labels without changing user names', () => {
    expect(translateDynamicVi('Remove member analyst@example.local?')).toBe('Xóa thành viên analyst@example.local?');
    expect(translateDynamicVi('12 widgets')).toBe('12 thành phần');
    expect(translateDynamicVi('Unrecognized user content')).toBeUndefined();
  });

  it('localizes built-in catalog labels while preserving unknown catalog and source values', () => {
    const fallback = { name: '原始名称', description: '原始描述' };
    expect(localizeConnectorCatalog('feishu', 'vi', fallback).name).toBe('Lark');
    expect(localizeConnectorCatalog('custom', 'vi', fallback)).toEqual(fallback);
    expect(localizeConnectorCatalog('feishu', 'zh', fallback)).toEqual(fallback);
    expect(localizeConnectorField('auth_type', 'vi', '认证方式')).toBe('Phương thức xác thực');
    expect(localizeConnectorField('unknown', 'vi', 'Custom field')).toBe('Custom field');
    expect(dashboardSourceLabel('sqlite_voice_lab', 'vi')).toContain('Dữ liệu mẫu tổng hợp');
    expect(dashboardSourceLabel('my-own-source', 'vi')).toBe('my-own-source');
  });

  it('preserves interpolation variables in translated strings', () => {
    const english = i18n.getResourceBundle('en', 'translation') as Record<string, unknown>;
    const placeholders = (value: string) => [...value.matchAll(/{{\s*([^{}]+?)\s*}}/g)].map(match => match[1]).sort();
    for (const [key, translated] of Object.entries(vi)) {
      if (typeof english[key] === 'string') {
        expect(placeholders(translated), key).toEqual(placeholders(english[key] as string));
      }
    }
  });

  it('covers every English translation key', () => {
    const english = i18n.getResourceBundle('en', 'translation') as Record<string, unknown>;
    expect(Object.keys(english).filter(key => key !== '__fallback_test' && !(key in vi))).toEqual([]);
  });

  it('covers literal bilingual Dashboard labels', () => {
    const dashboard = join(process.cwd(), 'new-components/dashboard');
    const missing = new Set<string>();
    for (const name of readdirSync(dashboard)) {
      if (!name.endsWith('.tsx') || name.includes('.test.')) continue;
      const source = readFileSync(join(dashboard, name), 'utf8');
      const pairs = source.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g);
      for (const pair of pairs) {
        const english = pair[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        // These values are a separator and an internal language selector, not UI copy.
        if (english !== ' · ' && english !== 'en' && !(english in viUiText)) missing.add(english);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });

  it('covers literal bilingual execution and trace panel labels', () => {
    const chat = join(process.cwd(), 'new-components/chat/content');
    const missing = new Set<string>();
    for (const name of ['ManusLeftPanel.tsx', 'ManusRightPanel.tsx', 'ConversationTracePanel.tsx']) {
      const source = readFileSync(join(chat, name), 'utf8');
      const pairs = source.matchAll(/\btr\(\s*'((?:[^'\\]|\\.)*)'\s*,\s*'((?:[^'\\]|\\.)*)'\s*\)/g);
      for (const pair of pairs) {
        const english = pair[2].replace(/\\'/g, "'").replace(/\\\\/g, '\\');
        if (!(english in viUiText)) missing.add(english);
      }
    }
    expect([...missing].sort()).toEqual([]);
  });
});
