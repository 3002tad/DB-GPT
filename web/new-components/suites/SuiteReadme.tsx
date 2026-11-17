import { FileTextOutlined } from '@ant-design/icons';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

import styles from './SuiteReadme.module.css';
import { useUiText } from '@/hooks/use-ui-text';
import { useTranslation } from 'react-i18next';

type SuiteReadmeProps = {
  children: string;
  label: string;
};

export default function SuiteReadme({ children, label }: SuiteReadmeProps) {
  const { i18n } = useTranslation();
  const tr = useUiText();
  // Package documentation is source content, not generated UI copy. Preserve
  // untranslated originals explicitly instead of silently presenting them as Vietnamese.
  const original = !i18n.language.startsWith('zh') && /[\u4e00-\u9fff]/.test(children);
  return (
    <section className={styles.card} aria-label={label} data-testid='suite-readme'>
      <div className={styles.label}>
        <FileTextOutlined aria-hidden />
        <span>{label}</span>
      </div>
      <details className={styles.content} open={!original}>
        <summary>{original ? tr('原始文档', 'Original documentation') : label}</summary>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={{
            a: ({ children, href }) => (
              <a href={href} target='_blank' rel='noreferrer'>
                {children}
              </a>
            ),
            table: ({ children }) => (
              <div className={styles.tableScroll}>
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {children}
        </ReactMarkdown>
      </details>
    </section>
  );
}
