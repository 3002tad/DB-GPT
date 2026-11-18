import type { ProviderModel } from '@/types/model';
import { useTranslation } from 'react-i18next';

export default function ModelContextMetadata({ model }: { model: ProviderModel }) {
  const { t } = useTranslation();
  const length = model.context_length;
  const known = typeof length === 'number' && Number.isFinite(length) && length > 0;
  const display = known
    ? length >= 1_000_000 ? `${Number((length / 1_000_000).toFixed(2))}M`
      : length >= 1000 ? `${Number((length / 1000).toFixed(2))}K` : String(length)
    : '—';
  const title = [
    known ? `${t('context_length')}: ${length.toLocaleString()} token` : t('provider_metadata_unknown'),
    model.metadata_declaration === 'user_config' ? t('provider_metadata_manual') : '',
    model.metadata_source ? `${model.metadata_source} (${model.metadata_checked_at || '—'})` : '',
    t('provider_context_not_quota'),
  ].filter(Boolean).join('\n');
  return <span className='text-xs text-gray-400 w-16 text-right' title={title}>{display}</span>;
}
