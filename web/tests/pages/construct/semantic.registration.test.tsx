import i18n from '@/app/i18n';
import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import SemanticCenter from '@/pages/construct/semantic';

const state = vi.hoisted(() => ({ query: {} as Record<string, string>, status: 'missing', sync: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => ({ query: state.query, push: vi.fn(), replace: vi.fn() }) }));
vi.mock('@/new-components/layout/Construct', () => ({ default: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/new-components/chat/content/SemanticProvenance', () => ({ SemanticSourceDetail: () => null }));
vi.mock('@/client/api', () => ({ apiInterceptors: async (request: Promise<unknown>) => [null, await request] }));
vi.mock('@/client/api/semantic', () => {
  const source = () => ({ id: 1, conn_id: 'fixture', conn_name: 'Deleted fixture', db_type: 'sqlite', status: 'not_activated', connection_status: state.status });
  const empty = async () => [];
  return {
    getSemanticSpaces: async () => [source(), { ...source(), id: 2, conn_id: 'main', conn_name: 'Main source', connection_status: 'configured' }],
    getSemanticSpace: async () => source(), getSemanticCoverage: async () => null,
    getSemanticTables: empty, getSemanticEntries: empty, getSemanticExamples: empty,
    getSemanticMetrics: empty, getSemanticRelations: empty, getSemanticRules: empty,
    getSemanticMetricVersion: vi.fn(), postEntryReview: vi.fn(), postMetricPublish: vi.fn(), postRuleStatus: vi.fn(),
    postSemanticActivate: vi.fn(), postSemanticBackfill: vi.fn(), postSemanticDrafts: vi.fn(), postSemanticSync: state.sync,
  };
});

beforeEach(async () => {
  state.query = {};
  state.status = 'missing';
  state.sync.mockClear();
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({
    getPropertyValue: () => '', overflow: 'visible', overflowX: 'visible', overflowY: 'visible',
  } as unknown as CSSStyleDeclaration);
  await i18n.changeLanguage('vi');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('labels the retained source and disables only its sync action in the list', async () => {
  render(<SemanticCenter />);
  const source = await screen.findByText('Deleted fixture');
  const row = source.closest('tr')!;
  expect(within(row).getByText('Nguồn đã gỡ hoặc không còn đăng ký')).toBeTruthy();
  expect((within(row).getByRole('button', { name: /Đồng bộ metadata/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((within(row).getByRole('button', { name: /Mở không gian/ }) as HTMLButtonElement).disabled).toBe(false);
  const main = screen.getByText('Main source').closest('tr')!;
  expect((within(main).getByRole('button', { name: /Đồng bộ metadata/ }) as HTMLButtonElement).disabled).toBe(false);
  expect(state.sync).not.toHaveBeenCalled();
});

it('explains snapshot retention on detail without hiding metadata or offline governance', async () => {
  state.query = { ds: '1' };
  render(<SemanticCenter />);
  expect(await screen.findByText('Nguồn đã gỡ hoặc không còn đăng ký')).toBeTruthy();
  expect(screen.getByText(/Metadata được giữ là snapshot trước đó/)).toBeTruthy();
  expect((screen.getByRole('button', { name: /Đồng bộ metadata/ }) as HTMLButtonElement).disabled).toBe(true);
  expect((screen.getByRole('button', { name: /Tạo bản nháp/ }) as HTMLButtonElement).disabled).toBe(false);
});

it('distinguishes a registry lookup outage from a removed connection', async () => {
  state.query = { ds: '1' };
  state.status = 'unknown';
  render(<SemanticCenter />);
  expect(await screen.findByText('Chưa kiểm tra được đăng ký nguồn')).toBeTruthy();
  expect(screen.queryByText('Nguồn đã gỡ hoặc không còn đăng ký')).toBeNull();
  expect((screen.getByRole('button', { name: /Đồng bộ metadata/ }) as HTMLButtonElement).disabled).toBe(false);
});
