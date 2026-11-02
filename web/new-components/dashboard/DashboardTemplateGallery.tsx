import { useTranslation } from 'react-i18next';
import { getDbList } from '@/client/api';
import { dashboardSourceLabel } from '@/new-components/dashboard/dashboard-source-label';
import { ADAPTED_SKILLS } from '@/new-components/skills/skill-catalog';
import { FolderOutlined, SearchOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { useRequest } from 'ahooks';
import { Alert, Button, Empty, Input, Spin } from 'antd';
import Image from 'next/image';
import { useRouter } from 'next/router';
import { useMemo, useState } from 'react';
import { AVAILABLE_CATALOG, catalogProof, type CatalogTemplate } from './dashboard-catalog';
import DashboardDesignTemplate from './DashboardDesignTemplate';
import styles from './DashboardGallery.module.css';
import DashboardTemplateCarousel from './DashboardTemplateCarousel';
import DashboardTemplateLayoutPreview from './DashboardTemplateLayoutPreview';
import DashboardTemplateSetup from './DashboardTemplateSetup';
import { useTemplateFavorites } from './use-template-favorites';
import { useUiText } from '@/hooks/use-ui-text';
import { designEnglish, galleryCategories, templateEnglish } from './dashboard-gallery-locales';

const showcaseOrder = [
  'clinical-insight',
  'cardio-journal',
  'voice-observatory',
  'store-marketing',
  'national-command',
  'healthcare-command',
  'rural-finance',
  'brand-revenue',
];
const catalogPriority = (id: string) => {
  const index = showcaseOrder.indexOf(id);
  return index < 0 ? showcaseOrder.length : index;
};

// The user's selected styles and data templates share one display order.
const preferredTemplates = [
  'design:learnhub-viz-design',
  'design:brutal-viz-design',
  'design:pawspa-viz-design',
  'design:serenityspa-viz-design',
  'voice-observatory',
  'store-marketing',
  'national-command',
  'brand-revenue',
  'business-dossier',
  'store-coverage',
  'northwind-revenue',
  'northwind-freight',
];
const preferredPriority = (id: string) => {
  const index = preferredTemplates.indexOf(id);
  return index < 0 ? preferredTemplates.length : index;
};

export default function DashboardTemplateGallery({ featured = false }: { featured?: boolean }) {
  const tr = useUiText();
  const { i18n } = useTranslation();
  const router = useRouter();
  const [category, setCategory] = useState('全部');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<CatalogTemplate | null>(null);
  const [collection, setCollection] = useState<'all' | 'design' | 'favorites'>('all');
  const { favorites, toggle } = useTemplateFavorites();
  const {
    data: sources = [],
    loading,
    error,
    refresh: loadSources,
  } = useRequest(
    async () => {
      const response = await getDbList();
      if (!response.data.success) throw new Error(response.data.err_msg || '数据源暂时无法读取');
      const records = response.data.data as unknown as { db_name?: string; params?: { name?: string } }[];
      return records.map(item => item.db_name || item.params?.name || '').filter(Boolean);
    },
    { onError: () => {} },
  ); // Errors are shown in the gallery's retry alert.
  const available = useMemo(
    () =>
      sources.length
        ? [...AVAILABLE_CATALOG].sort(
            (a, b) => catalogPriority(a.id) - catalogPriority(b.id) || Number(!!b.style) - Number(!!a.style),
          )
        : [],
    [sources],
  );
  const categories =
    collection === 'design' ? ['全部', '设计'] : ['全部', ...new Set(available.map(item => item.category)), '设计'];
  const filtered = available.filter(
    item =>
      (category === '全部' || item.category === category) &&
      collection !== 'design' &&
      (collection !== 'favorites' || favorites.includes(item.id)) &&
      `${item.title} ${item.description} ${(templateEnglish[item.id] || []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()),
  );
  const featuredIds = [
    'brand-revenue',
    'retail-overview',
    'growth-map',
    'retail-terminal',
    'service-desk',
    'sales-receipt',
  ];
  const matches = featured ? featuredIds.flatMap(id => filtered.filter(item => item.id === id)) : filtered;
  const designs = featured
    ? []
    : Object.entries(ADAPTED_SKILLS).filter(
        ([name, design]) =>
          (category === '全部' || category === '设计') &&
          (collection !== 'favorites' || favorites.includes(`design:${name}`)) &&
          `${design.title} ${design.description} ${(designEnglish[name] || []).join(' ')}`.toLowerCase().includes(search.trim().toLowerCase()),
      );
  const open = (item: CatalogTemplate) => {
    setSelected(item);
  };
  const cards = matches.map(item => {
    const proof = catalogProof(item.id);
    const title = tr(item.title, templateEnglish[item.id]?.[0] || item.title);
    const description = tr(item.description, templateEnglish[item.id]?.[1] || item.description);
    return (
      <article key={item.id} className={styles.card} data-catalog-template={item.id}>
        <button type='button' className={styles.cover} aria-label={tr(`预览模板 ${title}`, `Preview template ${title}`)} onClick={() => open(item)}>
          {proof?.previewKind === 'layout' || (proof?.preview && tr('zh', 'en') === 'en') ? (
            <DashboardTemplateLayoutPreview template={item} />
          ) : proof?.preview ? (
            <Image src={proof.preview} alt={tr(`${title}实际生成预览`, `Generated preview of ${title}`)} width={640} height={400} />
          ) : (
            <div className={styles.assetCover}>
              <strong>{title}</strong>
              <span>{item.sourceNames[0]}</span>
            </div>
          )}
          <span className={styles.badge}>{tr(item.category, galleryCategories[item.category] || item.category)}</span>
          <span className={styles.coverAction}>{tr('查看模板', 'View template')}</span>
        </button>
        <button
          type='button'
          className={styles.favorite}
          aria-label={favorites.includes(item.id) ? tr(`取消收藏模板 ${title}`, `Remove ${title} from favorites`) : tr(`收藏模板 ${title}`, `Add ${title} to favorites`)}
          aria-pressed={favorites.includes(item.id)}
          onClick={() => toggle(item.id)}
        >
          {favorites.includes(item.id) ? <StarFilled /> : <StarOutlined />}
        </button>
        <div className={styles.cardTitle}>
          <button type='button' onClick={() => open(item)}>
            {title}
          </button>
        </div>
        <p className={styles.description}>{description}</p>
        <div className={styles.meta}>
          <span>{dashboardSourceLabel(proof?.source || item.sourceNames[0], i18n.language)}</span>
        </div>
      </article>
    );
  });
  const orderedCards = [
    ...cards.map((card, index) => ({ id: matches[index].id, card })),
    ...designs.map(([name]) => ({
      id: `design:${name}`,
      card: (
        <DashboardDesignTemplate
          key={`design:${name}`}
          name={name}
          favorite={favorites.includes(`design:${name}`)}
          onFavorite={() => toggle(`design:${name}`)}
        />
      ),
    })),
  ].sort((a, b) => preferredPriority(a.id) - preferredPriority(b.id));
  return (
    <>
      {!featured && (
        <nav className={styles.collections} aria-label={tr('模板文件夹', 'Template collections')}>
          <button
            type='button'
            aria-pressed={collection === 'all'}
            onClick={() => {
              setCollection('all');
              setCategory('全部');
            }}
          >
            {tr('全部模板', 'All templates')}
          </button>
          <button
            type='button'
            aria-pressed={collection === 'design'}
            onClick={() => {
              setCollection('design');
              setCategory('全部');
            }}
          >
            {tr('风格技能', 'Design skills')}
          </button>
          <button
            type='button'
            aria-pressed={collection === 'favorites'}
            onClick={() => {
              setCollection('favorites');
              setCategory('全部');
            }}
          >
            <FolderOutlined /> {tr('收藏夹', 'Favorites')}{' '}
            <span>
              {
                favorites.filter(
                  id =>
                    AVAILABLE_CATALOG.some(item => item.id === id) ||
                    (id.startsWith('design:') && ADAPTED_SKILLS[id.slice(7)]),
                ).length
              }
            </span>
          </button>
        </nav>
      )}
      {!featured && (
        <div className={styles.tools}>
          <div className={styles.categories} aria-label={tr('模板业务分类', 'Template categories')}>
            {categories.map(item => (
              <button key={item} type='button' aria-pressed={category === item} onClick={() => setCategory(item)}>
                {tr(item, galleryCategories[item] || item)}
              </button>
            ))}
          </div>
          <Input
            className={styles.search}
            prefix={<SearchOutlined />}
            placeholder={tr('搜索模板', 'Search templates')}
            aria-label={tr('搜索模板', 'Search templates')}
            value={search}
            allowClear
            onChange={event => setSearch(event.target.value)}
          />
        </div>
      )}
      {error ? (
        <Alert
          type='error'
          showIcon
          message={tr('暂时无法连接数据服务，请恢复连接后重试。', 'Could not connect to the data service. Retry when the connection is restored.')}
          action={
            <Button
              onClick={() => {
                void loadSources();
              }}
            >
              {tr('重试', 'Retry')}
            </Button>
          }
        />
      ) : loading ? (
        <Spin />
      ) : available.length < 2 && !designs.length ? (
        <Alert
          type='info'
          showIcon
          message={tr('可用模板不足，暂不展示模板广场', 'Not enough templates are available')}
          description={tr('请先恢复模板数据源，或继续编辑已有看板。', 'Restore the template data source or continue editing an existing dashboard.')}
          action={<Button onClick={() => router.push('/dashboards/?tab=all')}>{tr('全部看板', 'All dashboards')}</Button>}
        />
      ) : matches.length || designs.length ? (
        featured ? (
          <DashboardTemplateCarousel>{cards}</DashboardTemplateCarousel>
        ) : (
          <div className={styles.grid}>{orderedCards.map(item => item.card)}</div>
        )
      ) : (
        <Empty
          description={
            search
              ? tr('没有匹配的模板', 'No matching templates')
              : collection === 'favorites'
                ? tr('还没有收藏模板，点击卡片右上角的星标即可收纳到这里。', 'No favorites yet. Select the star on a template to save it here.')
                : tr('当前分类没有模板', 'No templates in this category')
          }
        />
      )}
      {selected && <DashboardTemplateSetup template={selected} sources={sources} onClose={() => setSelected(null)} />}
    </>
  );
}
