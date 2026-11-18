import type { BackEndChartType } from '@/components/chart/autoChart';
import dynamic from 'next/dynamic';
import { nativeChartPayload } from '@/utils/native-chart-output';
import { useTranslation } from 'react-i18next';

const ChartView = dynamic(() => import('@/components/chat/chat-content/chart-view'), { ssr: false });

export default function NativeChartArtifact({ content }: { content: unknown }) {
  const { t } = useTranslation();
  const chart = nativeChartPayload(content);
  if (!chart) return <div role='alert'>{t('native_chart_unavailable', 'Chart data is unavailable.')}</div>;
  return (
    <section aria-label={chart.title || t('native_chart_title', 'Interactive chart')}
      className='w-full min-w-0 min-h-[320px] rounded-lg border border-[#e6e6e2] bg-white p-3 dark:border-[#2a2925] dark:bg-[#111217]'>
      {chart.describe && <p className='mb-2 text-sm'>{chart.describe}</p>}
      {!chart.data.length && <p role='status'>{t('native_chart_empty', 'The query returned no rows; no chart was drawn.')}</p>}
      <ChartView key={`${chart.type}:${chart.sql}`} data={chart.data} type={(chart.data.length ? chart.type : 'response_table') as BackEndChartType} sql={chart.sql} />
      {chart.artifact_id && <div className='mt-2 break-all text-xs text-gray-500'>{chart.artifact_id}</div>}
    </section>
  );
}
