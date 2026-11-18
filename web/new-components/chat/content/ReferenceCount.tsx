import { useTranslation } from 'react-i18next';

/** Counts reference entries, never independent documents inferred from names. */
export default function ReferenceCount({ count, compact = false }: { count: number; compact?: boolean }) {
  const { t } = useTranslation();
  const label = t('evidence_graph_cited_references', { count });
  return <span title={t('reference_count_help')} aria-label={compact ? label : undefined}>
    {compact ? count : label}
  </span>;
}
