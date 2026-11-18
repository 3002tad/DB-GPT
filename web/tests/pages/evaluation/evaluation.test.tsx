import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import i18n from '@/app/i18n';
import Evaluation from '@/pages/evaluation';

const api = vi.hoisted(() => ({ upload: vi.fn(), storage: vi.fn() }));
vi.mock('@/client/api', () => {
  const ok = (data: unknown) => Promise.resolve({ data: { success: true, data } });
  return {
    apiInterceptors: async (request: Promise<any>) => {
      const result = await request;
      return [null, result.data.data, result.data];
    },
    getStorageTypes: () => { api.storage(); return ok([{ db: 'Database JSON' }, { file: 'Upload file (database storage)' }]); },
    getDataSets: () => ok({ items: [], total_count: 0 }),
    getEvaluations: () => ok({ items: [], total_count: 0 }),
    getMetrics: () => ok([{ name: 'ExactMatchMetric', describe: 'ExactMatchMetric' }]),
    getAppList: () => ok({ app_list: [] }), getSpaceList: () => ok([]),
    uploadDataSetsContent: (data: unknown) => { api.upload(data); return ok({ code: 'created' }); },
    uploadDataSetsFile: (data: unknown) => { api.upload(data); return ok({ code: 'created' }); },
    createEvaluations: () => ok({}), delDataSet: () => ok(true), delEvaluation: () => ok(true),
    downloadDataSet: vi.fn(), downloadEvaluation: vi.fn(), showEvaluation: () => ok([]), updateEvaluations: () => ok(true),
  };
});

beforeEach(async () => {
  api.upload.mockClear(); api.storage.mockClear();
  // jsdom's style engine cannot evaluate Ant's nested :has selectors. Layout
  // measurement is outside these form tests; retain real Modal/Form/Select.
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '', overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
  } as unknown as CSSStyleDeclaration);
  await i18n.changeLanguage('vi');
});
afterEach(() => vi.restoreAllMocks());

it('loads storage choices and submits JSON without requiring members, using localized controls', async () => {
  render(<Evaluation />);
  await waitFor(() => expect(api.storage).toHaveBeenCalled());
  fireEvent.click(screen.getByText('Bộ dữ liệu'));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bộ dữ liệu' }));
  const modal = await screen.findByRole('dialog');
  fireEvent.change(within(modal).getByLabelText('Tên'), { target: { value: 'Fixture' } });
  fireEvent.mouseDown(within(modal).getByLabelText('Kiểu lưu trữ'));
  fireEvent.click(await screen.findByText('JSON lưu trong cơ sở dữ liệu'));
  const json = '[{"query":"source 原始","factual":"42"}]';
  fireEvent.change(await within(modal).findByLabelText('Nội dung JSON'), { target: { value: json } });
  fireEvent.click(within(modal).getByRole('button', { name: /^OK$/ }));
  await waitFor(() => expect(api.upload).toHaveBeenCalledWith({ dataset_name: 'Fixture', members: '', content: json }));
});

it('supports file storage selection rather than a permanently empty dropdown', async () => {
  render(<Evaluation />);
  fireEvent.click(screen.getByText('Bộ dữ liệu'));
  fireEvent.click(screen.getByRole('button', { name: 'Thêm bộ dữ liệu' }));
  const modal = await screen.findByRole('dialog');
  fireEvent.change(within(modal).getByLabelText('Tên'), { target: { value: 'CSV upload' } });
  await waitFor(() => expect(api.storage).toHaveBeenCalled());
  fireEvent.mouseDown(within(modal).getByLabelText('Kiểu lưu trữ'));
  fireEvent.click(await screen.findByText('Tải tệp lên (lưu trong cơ sở dữ liệu)'));
  expect(await within(modal).findByRole('button', { name: /Tải bộ dữ liệu lên/ })).toBeTruthy();
  const file = new File(['query,factual\nanswer?,42'], 'fixture.csv', { type: 'text/csv' });
  fireEvent.change(modal.querySelector('input[type="file"]')!, { target: { files: [file] } });
  await within(modal).findByText('fixture.csv');
  fireEvent.click(within(modal).getByRole('button', { name: /^OK$/ }));
  await waitFor(() => expect(api.upload).toHaveBeenCalled());
  const uploaded = api.upload.mock.calls[0][0] as FormData;
  expect(uploaded.get('doc_file')).toBeInstanceOf(File);
  expect((uploaded.get('doc_file') as File).name).toBe('fixture.csv');
  expect(within(modal).queryByText('储存类型')).toBeNull();
  await act(async () => { await Promise.resolve(); });
});
