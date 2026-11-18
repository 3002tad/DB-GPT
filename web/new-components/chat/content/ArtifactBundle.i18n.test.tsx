import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '@/app/i18n';
import ArtifactCards, { type StreamArtifact } from './ArtifactCards';
import ArtifactRail from './ArtifactRail';

vi.mock('@/new-components/common/MarkdownContext', () => ({ default: () => null }));
vi.mock('@/new-components/dashboard/DashboardArtifactPreview', () => ({ default: () => null }));

afterEach(async () => { cleanup(); await i18n.changeLanguage('vi'); });

const items: StreamArtifact[] = [{
  id: 'csv', type: 'file', name: '原始.csv', content: { content: 'source,count\n原始,7' },
}];

it.each([
  ['vi', 'Xem trước và tải xuống · 1 tệp', 'Mở'],
  ['en', 'Preview and download · 1 files', 'Open'],
  ['zh', '预览与下载 · 1 个文件', '打开'],
])('localizes the consolidated product card in %s without changing its filename', async (locale, meta, open) => {
  await i18n.changeLanguage(locale);
  const onPreview = vi.fn();
  render(<ArtifactCards consolidate artifacts={items} onPreview={onPreview} />);
  expect(screen.getByText(meta)).toBeTruthy();
  expect(screen.getByText(open)).toBeTruthy();
  fireEvent.click(screen.getByRole('button'));
  expect(onPreview.mock.calls[0][0].content.items).toEqual(items);
  expect(screen.getByText('原始.csv')).toBeTruthy();
});

it('switches bundle controls with the UI locale while preserving file contents', async () => {
  await i18n.changeLanguage('vi');
  render(<ArtifactRail artifacts={items} previewArtifact={{
    id: 'bundle', type: 'artifact_bundle', name: '原始.csv', content: { primaryId: 'csv', items },
  }} onPreview={vi.fn()} onDebug={vi.fn()} onClose={vi.fn()} />);
  expect(screen.getByLabelText('Chọn tệp để xem trước')).toBeTruthy();
  expect(screen.getByText('Tệp')).toBeTruthy();
  await act(() => i18n.changeLanguage('en'));
  expect(screen.getByLabelText('Select a file to preview')).toBeTruthy();
  expect(screen.getByText('Files')).toBeTruthy();
  expect(screen.getByRole('option').textContent).toBe('原始.csv');
});
