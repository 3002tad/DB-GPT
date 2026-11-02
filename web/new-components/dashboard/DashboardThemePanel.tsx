import { useUiText } from '@/hooks/use-ui-text';
import {
  DashboardThemeDensity,
  DashboardThemeFontScale,
  DashboardThemeKpiStyle,
  DashboardThemeMode,
  DashboardThemeOverrides,
  DashboardThemeShadow,
  DashboardThemeTableStyle,
  DashboardVisualTheme,
} from '@/types/dashboard';
import { BgColorsOutlined, DownOutlined, ReloadOutlined, UpOutlined } from '@ant-design/icons';
import { Alert, Button, InputNumber, Segmented, Select } from 'antd';
import { useMemo, useState } from 'react';
import styles from './DashboardWorkspace.module.css';
import {
  DASHBOARD_THEME_PRESETS,
  DashboardThemeId,
  auditDashboardTheme,
  resolveDashboardTheme,
} from './dashboard-appearance';

interface DashboardThemePanelProps {
  theme?: DashboardVisualTheme;
  onChange: (theme: DashboardVisualTheme) => void;
}

const sameValue = (left: unknown, right: unknown) => JSON.stringify(left) === JSON.stringify(right);
const themeNames: Record<DashboardThemeId, string> = { clarity: 'Clarity', ocean: 'Ocean', warm: 'Warm', graphite: 'Graphite' };
const auditEnglish: Record<string, string> = {
  text_contrast: 'Text contrast against the card background is below 4.5:1.',
  muted_contrast: 'Secondary text contrast against the card background is below 3:1.',
  palette_duplicate: 'The chart palette contains duplicate colors.',
};
const englishAuditMessage = (code: string, original: string) => {
  if (code === 'palette_contrast') return `Chart palette colors ${original.match(/第 (.+?) 个/)?.[1] || ''} have contrast below 3:1.`;
  if (code === 'palette_colorblind_collision') return `Some color combinations are difficult to distinguish under color vision simulation: ${original.split('：')[1] || ''}`;
  return auditEnglish[code] || original;
};

export default function DashboardThemePanel({ theme, onChange }: DashboardThemePanelProps) {
  const tr = useUiText();
  const [customizing, setCustomizing] = useState(false);
  const resolved = useMemo(() => resolveDashboardTheme(theme), [theme]);
  const base = useMemo(
    () => resolveDashboardTheme({ preset: resolved.id, mode: resolved.mode, overrides: {} }),
    [resolved.id, resolved.mode],
  );
  const issues = useMemo(() => auditDashboardTheme(theme), [theme]);
  const overrides = theme?.overrides || {};
  const overrideCount = Object.values(overrides).filter(value => value != null).length;

  const emit = (nextOverrides: DashboardThemeOverrides, preset = resolved.id, mode = resolved.mode) =>
    onChange({ preset, mode, overrides: nextOverrides });

  const setOverride = <Key extends keyof DashboardThemeOverrides>(
    key: Key,
    value: NonNullable<DashboardThemeOverrides[Key]>,
    baseValue: unknown,
  ) => {
    const next = { ...overrides };
    if (sameValue(value, baseValue)) delete next[key];
    else next[key] = value;
    emit(next);
  };

  return (
    <section className={styles.themePanel} aria-labelledby='dashboard-visual-theme-title'>
      <div className={styles.themePanelHeading}>
        <div>
          <h3 id='dashboard-visual-theme-title' className={styles.sectionTitle}>
            {tr('视觉主题', 'Visual theme')}
          </h3>
          <p className={styles.themePanelHint}>{tr('只改变看板内容与发布页', 'Applies to dashboard content and published pages')}</p>
        </div>
        <BgColorsOutlined aria-hidden='true' />
      </div>
      <div className={styles.themePresetGrid}>
        {(Object.keys(DASHBOARD_THEME_PRESETS) as DashboardThemeId[]).map(id => {
          const definition = DASHBOARD_THEME_PRESETS[id];
          const preview = definition.modes[resolved.mode];
          const selected = resolved.id === id;
          return (
            <button
              key={id}
              type='button'
              aria-label={tr(`选择${definition.label}主题`, `Select ${themeNames[id]} theme`)}
              aria-pressed={selected}
              data-testid={`dashboard-theme-${id}`}
              className={`${styles.themePresetCard} ${selected ? styles.themePresetCardSelected : ''}`}
              style={{ backgroundColor: preview.card, borderColor: selected ? preview.primary : preview.border }}
              onClick={() => emit(overrides, id, resolved.mode)}
            >
              <span className={styles.themePresetPreview} style={{ backgroundColor: preview.canvas }}>
                <span style={{ backgroundColor: preview.primary }} />
                <span style={{ backgroundColor: preview.chartPalette[1] }} />
                <span style={{ backgroundColor: preview.chartPalette[2] }} />
              </span>
              <span style={{ color: preview.text }}>{tr(definition.label, themeNames[id])}</span>
            </button>
          );
        })}
      </div>
      <Segmented
        block
        size='small'
        aria-label={tr('主题明暗模式', 'Theme light or dark mode')}
        value={resolved.mode}
        options={[
          { label: tr('浅色', 'Light'), value: 'light' },
          { label: tr('深色', 'Dark'), value: 'dark' },
        ]}
        onChange={value => emit(overrides, resolved.id, value as DashboardThemeMode)}
      />
      <Button
        type='text'
        size='small'
        className={styles.themeCustomizeToggle}
        aria-label={customizing ? tr('收起二次创作', 'Collapse customization') : tr('展开二次创作', 'Expand customization')}
        aria-expanded={customizing}
        onClick={() => setCustomizing(current => !current)}
        icon={customizing ? <UpOutlined /> : <DownOutlined />}
      >
        {tr('二次创作', 'Customize')}{overrideCount ? tr(`（${overrideCount} 项）`, ` (${overrideCount})`) : ''}
      </Button>
      {customizing && (
        <div className={styles.themeOverrideGrid} data-testid='dashboard-theme-overrides'>
          <label className={styles.themeField}>
            <span>{tr('主色', 'Primary color')}</span>
            <span className={styles.themeColorControl}>
              <input
                aria-label={tr('主题主色', 'Theme primary color')}
                type='color'
                value={resolved.primary}
                onChange={event => setOverride('primary_color', event.target.value.toUpperCase(), base.primary)}
              />
              <code>{resolved.primary}</code>
            </span>
          </label>
          <label className={styles.themeField}>
            <span>{tr('字号档位', 'Font size')}</span>
            <Select
              aria-label={tr('主题字号档位', 'Theme font size')}
              size='small'
              value={resolved.fontScale}
              options={[
                { value: 'compact', label: tr('紧凑', 'Compact') },
                { value: 'standard', label: tr('标准', 'Standard') },
                { value: 'large', label: tr('放大', 'Large') },
              ]}
              onChange={(value: DashboardThemeFontScale) => setOverride('font_scale', value, base.fontScale)}
            />
          </label>
          <label className={styles.themeField}>
            <span>{tr('留白密度', 'Spacing density')}</span>
            <Select
              aria-label={tr('主题留白密度', 'Theme spacing density')}
              size='small'
              value={resolved.density}
              options={[
                { value: 'compact', label: tr('紧凑', 'Compact') },
                { value: 'comfortable', label: tr('舒适', 'Comfortable') },
                { value: 'spacious', label: tr('宽松', 'Spacious') },
              ]}
              onChange={(value: DashboardThemeDensity) => setOverride('density', value, base.density)}
            />
          </label>
          <label className={styles.themeField}>
            <span>{tr('卡片圆角', 'Card corners')}</span>
            <InputNumber
              aria-label={tr('主题卡片圆角', 'Theme card corners')}
              size='small'
              min={0}
              max={28}
              value={resolved.radius}
              addonAfter='px'
              onChange={value => setOverride('card_radius', Number(value ?? base.radius), base.radius)}
            />
          </label>
          <label className={styles.themeField}>
            <span>{tr('卡片阴影', 'Card shadow')}</span>
            <Select
              aria-label={tr('主题卡片阴影', 'Theme card shadow')}
              size='small'
              value={overrides.card_shadow || 'soft'}
              options={[
                { value: 'none', label: tr('无', 'None') },
                { value: 'soft', label: tr('柔和', 'Soft') },
                { value: 'elevated', label: tr('悬浮', 'Elevated') },
              ]}
              onChange={(value: DashboardThemeShadow) => setOverride('card_shadow', value, 'soft')}
            />
          </label>
          <label className={styles.themeField}>
            <span>{tr('KPI 样式', 'KPI style')}</span>
            <Select
              aria-label={tr('主题 KPI 样式', 'Theme KPI style')}
              size='small'
              value={resolved.kpiStyle}
              options={[
                { value: 'quiet', label: tr('克制', 'Quiet') },
                { value: 'accent', label: tr('强调', 'Accent') },
                { value: 'solid', label: tr('色块', 'Solid') },
              ]}
              onChange={(value: DashboardThemeKpiStyle) => setOverride('kpi_style', value, base.kpiStyle)}
            />
          </label>
          <label className={styles.themeField}>
            <span>{tr('表格样式', 'Table style')}</span>
            <Select
              aria-label={tr('主题表格样式', 'Theme table style')}
              size='small'
              value={resolved.tableStyle}
              options={[
                { value: 'plain', label: tr('纯净', 'Plain') },
                { value: 'striped', label: tr('斑马纹', 'Striped') },
                { value: 'divided', label: tr('分隔线', 'Divided') },
              ]}
              onChange={(value: DashboardThemeTableStyle) => setOverride('table_style', value, base.tableStyle)}
            />
          </label>
          <div className={styles.themeFieldWide}>
            <span>{tr('图表色板', 'Chart palette')}</span>
            <div className={styles.themePaletteEditor}>
              {resolved.chartPalette.map((color, index) => (
                <input
                  key={`${index}-${color}`}
                  aria-label={tr(`图表色板颜色 ${index + 1}`, `Chart palette color ${index + 1}`)}
                  type='color'
                  value={color}
                  onChange={event => {
                    const next = [...resolved.chartPalette];
                    next[index] = event.target.value.toUpperCase();
                    setOverride('chart_palette', next, base.chartPalette);
                  }}
                />
              ))}
            </div>
          </div>
          {!!issues.length && (
            <Alert className={styles.themeAuditAlert} type='error' showIcon message={tr(issues[0].message, englishAuditMessage(issues[0].code, issues[0].message))} />
          )}
          <Button
            className={styles.themeResetButton}
            size='small'
            icon={<ReloadOutlined />}
            aria-label={tr('恢复主题默认', 'Restore theme defaults')}
            disabled={!overrideCount}
            onClick={() => emit({})}
          >
            {tr('恢复主题默认', 'Restore theme defaults')}
          </Button>
        </div>
      )}
    </section>
  );
}
