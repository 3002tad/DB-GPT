import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/app/i18n';
import ArtifactCards from './ArtifactCards';
import ArtifactRail from './ArtifactRail';
import NativeChartArtifact from './NativeChartArtifact';
import { nativeChartsFromOutput } from '@/utils/native-chart-output';
import { envelopeEmbeddedOutputs } from '@/utils/tool-envelope';

vi.mock('@/components/chart/autoChart', () => ({
  AutoChart: ({ data }: any) => <svg role='img' aria-label='native-renderer' data-rows={JSON.stringify(data)} />,
  getChartType: (type: string) => [type],
}));
vi.mock('@/new-components/common/MarkdownContext', () => ({ default: () => null }));
vi.mock('@/new-components/dashboard/DashboardArtifactPreview', () => ({ default: () => null }));
vi.mock('next/dynamic', async () => {
  const { lazy, Suspense } = await import('react');
  return { default: (loader: Parameters<typeof lazy>[0]) => {
    const Component = lazy(loader);
    return (props: any) => <Suspense fallback={null}><Component {...props} /></Suspense>;
  } };
});

const payload = {
  renderer: 'vis-db-chart' as const, type: 'response_line_chart', sql: 'SELECT month, sessions FROM monthly',
  describe: 'Phiên theo tháng', data: [{ month: '2025-11', sessions: 7327 }, { month: '2025-12', sessions: 8965 }],
  artifact_id: 'chart-fixture', input_artifact_ids: ['sql-fixture'],
};
afterEach(async () => { cleanup(); await act(async () => { await i18n.changeLanguage('vi'); }); });

describe('native chart chat delivery', () => {
  it.each([false, true])('renders the chart immediately in stream cards (consolidated=%s)', async consolidate => {
    await act(async () => { await i18n.changeLanguage('vi'); });
    const artifact = { id: 'chart', type: 'chart', name: 'Phiên theo tháng', content: payload };
    const { container } = render(<ArtifactCards artifacts={[artifact]} consolidate={consolidate} />);
    const chart = await screen.findByRole('img', { name: 'native-renderer' }, { timeout: 5000 });
    expect(chart.closest('.ant-tabs-tabpane-hidden')).toBeNull();
    expect(screen.getByRole('tab', { name: 'Biểu đồ' }).getAttribute('aria-selected')).toBe('true');
    expect(chart.getAttribute('data-rows')).toBe(JSON.stringify(payload.data));
    expect(container.textContent).toContain('chart-fixture');
    fireEvent.click(screen.getByRole('tab', { name: 'Dữ liệu' }));
    expect(screen.getByRole('cell', { name: '7327' })).toBeTruthy();
    fireEvent.click(screen.getByRole('tab', { name: 'SQL' }));
    expect(container.textContent).toContain('monthly');
  });

  it('opens the same native chart from the artifact bundle preview', async () => {
    const chart = { id: 'chart', type: 'chart', name: 'Monthly', content: payload };
    render(<ArtifactRail artifacts={[chart]} previewArtifact={{ id: 'bundle', type: 'artifact_bundle', name: 'Charts', content: { items: [chart] } }} onPreview={vi.fn()} onDebug={vi.fn()} onClose={vi.fn()} />);
    expect(await screen.findByRole('img', { name: 'native-renderer' })).toBeTruthy();
  });

  it('restores the exact old fenced protocol without a model or SQL call', async () => {
    const legacy = `\`\`\`vis-db-chart\n${JSON.stringify(payload)}\n\`\`\``;
    const [chart] = nativeChartsFromOutput({ output_type: 'markdown', content: legacy });
    expect(chart).toEqual(payload);
    render(<NativeChartArtifact content={chart} />);
    expect((await screen.findByRole('img', { name: 'native-renderer' })).getAttribute('data-rows')).toBe(JSON.stringify(payload.data));
    const embedded = envelopeEmbeddedOutputs(JSON.stringify({ chunks: [{ output_type: 'chart', content: payload }] }));
    expect(embedded).toEqual([{ type: 'chart', content: payload }]);
  });

  it('does not fabricate a graph or zero values when the query is empty', async () => {
    render(<NativeChartArtifact content={{ ...payload, data: [] }} />);
    expect(screen.queryByRole('img', { name: 'native-renderer' })).toBeNull();
    expect(screen.getByRole('status').textContent).toContain('Truy vấn không có dòng dữ liệu');
    expect((await screen.findByRole('tab', { name: 'Dữ liệu' })).getAttribute('aria-selected')).toBe('true');
  });

  it('retains unknown/malformed content as non-chart output', () => {
    expect(nativeChartsFromOutput({ output_type: 'text', content: JSON.stringify(payload) })).toEqual([]);
    expect(nativeChartsFromOutput({ output_type: 'markdown', content: '```vis-db-chart\n{broken}\n```' })).toEqual([]);
    expect(nativeChartsFromOutput({ output_type: 'chart', content: { ...payload, data: null } })).toEqual([]);
    render(<NativeChartArtifact content={null} />);
    expect(screen.getByRole('alert').textContent).toContain('Chưa có dữ liệu');
  });
});
