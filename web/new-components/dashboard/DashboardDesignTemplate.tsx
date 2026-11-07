import { ADAPTED_SKILLS } from '@/new-components/skills/skill-catalog';
import SkillPreview from '@/new-components/skills/SkillPreview';
import { ArrowRightOutlined, StarFilled, StarOutlined } from '@ant-design/icons';
import { Button, Modal } from 'antd';
import { useRouter } from 'next/router';
import { useState } from 'react';
import styles from './DashboardGallery.module.css';
import { useUiText } from '@/hooks/use-ui-text';
import { designEnglish } from './dashboard-gallery-locales';

export default function DashboardDesignTemplate({
  name,
  favorite,
  onFavorite,
}: {
  name: string;
  favorite: boolean;
  onFavorite: () => void;
}) {
  const tr = useUiText();
  const design = ADAPTED_SKILLS[name];
  const title = tr(design.title, designEnglish[name]?.[0] || design.title);
  const description = tr(design.description, designEnglish[name]?.[1] || design.description);
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const use = () =>
    void router.push({
      pathname: '/dashboards/new',
      query: {
        design_skill: name,
      },
    });
  return (
    <>
      <article className={`${styles.card} ${styles.designCard}`} data-design-template={name}>
        <button
          type='button'
          className={styles.cover}
          onClick={() => setOpen(true)}
          aria-label={tr(`预览模板 ${title}`, `Preview template ${title}`)}
        >
          <SkillPreview name={name} />
          <span className={styles.designLabel}>{tr('风格示意', 'Design sample')}</span>
          <span className={styles.coverAction}>{tr('查看风格', 'View design')}</span>
        </button>
        <button
          type='button'
          className={styles.favorite}
          aria-label={favorite ? tr(`取消收藏模板 ${title}`, `Remove ${title} from favorites`) : tr(`收藏模板 ${title}`, `Add ${title} to favorites`)}
          aria-pressed={favorite}
          onClick={onFavorite}
        >
          {favorite ? <StarFilled /> : <StarOutlined />}
        </button>
        <div className={styles.cardTitle}>
          <button type='button' onClick={() => setOpen(true)}>
            {title}
          </button>
        </div>
        <p className={styles.description}>{description}</p>
        <div className={styles.meta}>
          <span>{tr('风格技能 · 连接数据后生成', 'Design skill · Connect data to generate')}</span>
          <button type='button' onClick={use} aria-label={tr(`使用模板 ${title}`, `Use template ${title}`)}>
            {tr('使用', 'Use')} <ArrowRightOutlined />
          </button>
        </div>
      </article>
      <Modal
        open={open}
        title={title}
        onCancel={() => setOpen(false)}
        width={800}
        footer={
          <Button type='primary' onClick={use}>
            {tr('选择数据并创建看板', 'Choose data and create dashboard')}
          </Button>
        }
      >
        <div className={styles.designPreview}>
          <SkillPreview name={name} />
        </div>
        <p className='mt-4 text-[var(--app-muted)]'>{description}</p>
        <p className='mt-2 text-xs text-[var(--app-muted)]'>
          {tr('上方为风格示意。创建时使用你选择的数据，保留指标的真实口径与单位。', 'This preview illustrates the style. The dashboard uses your selected data and preserves metric definitions and units.')}
        </p>
      </Modal>
    </>
  );
}
