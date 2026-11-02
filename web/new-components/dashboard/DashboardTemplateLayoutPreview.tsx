import { useUiText } from '@/hooks/use-ui-text';
import type { CatalogTemplate } from './dashboard-catalog';
import { galleryCategories, templateEnglish } from './dashboard-gallery-locales';

export default function DashboardTemplateLayoutPreview({ template }: { template: CatalogTemplate }) {
  const tr = useUiText();
  const title = tr(template.title, templateEnglish[template.id]?.[0] || template.title);
  return (
    <svg
      viewBox='0 0 640 400'
      role='img'
      aria-label={tr(`${title}布局示意，连接数据后生成实际看板`, `${title} layout sample; connect data to generate a dashboard`)}
      data-template-layout={template.id}
    >
      <rect width='640' height='400' rx='12' fill='var(--app-surface-muted)' />
      <text x='28' y='42' fontSize='18' fontWeight='600' fill='var(--app-text)'>
        {title}
      </text>
      <text x='28' y='67' fontSize='12' fill='var(--app-muted)'>
        {tr(template.category, galleryCategories[template.category] || template.category)} · {tr('布局示意', 'Layout sample')}
      </text>
      {[28, 178, 328, 478].map(x => (
        <g key={x}>
          <rect x={x} y='88' width='134' height='75' rx='8' fill='var(--app-surface)' />
          <rect x={x + 14} y='104' width='56' height='6' rx='3' fill='var(--app-border)' />
          <rect x={x + 14} y='127' width='83' height='14' rx='3' fill='var(--app-accent-soft)' />
        </g>
      ))}
      <rect x='28' y='180' width='370' height='178' rx='8' fill='var(--app-surface)' />
      <text x='44' y='206' fontSize='12' fill='var(--app-muted)'>
        {tr('趋势区域', 'Trend area')}
      </text>
      <path d='M48 317 H376 M48 286 H376 M48 255 H376' stroke='var(--app-border)' fill='none' />
      <path
        d='M48 308 L103 278 L156 293 L211 254 L266 268 L320 237 L375 248'
        stroke='var(--app-accent)'
        strokeWidth='3'
        fill='none'
      />
      <rect x='416' y='180' width='196' height='178' rx='8' fill='var(--app-surface)' />
      <text x='432' y='206' fontSize='12' fill='var(--app-muted)'>
        {tr('分类区域', 'Category area')}
      </text>
      {[124, 95, 111, 67].map((width, index) => (
        <rect key={index} x='435' y={230 + index * 27} width={width} height='12' rx='3' fill='var(--app-accent-soft)' />
      ))}
      <text x='28' y='384' fontSize='11' fill='var(--app-muted)'>
        {tr('示意不含业务数值 · 连接数据后查看实际结果', 'Illustration only · Connect data to view results')}
      </text>
    </svg>
  );
}
