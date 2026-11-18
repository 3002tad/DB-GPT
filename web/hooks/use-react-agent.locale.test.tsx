import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import i18n from '@/app/i18n';
import useReActAgent from './use-react-agent';

afterEach(async () => { vi.unstubAllGlobals(); await i18n.changeLanguage('vi'); });

it('sends the current locale for KB chat while retaining bindings and source text', async () => {
  const fetcher = vi.fn(async (_url: string, _options: RequestInit) => ({
    ok: true, body: { getReader: () => ({ read: async () => ({ done: true }), cancel: vi.fn() }) },
  }));
  vi.stubGlobal('fetch', fetcher);
  const hook = renderHook(() => useReActAgent());
  const request = {
    user_input: '[Knowledge: 原始] Giải thích cart_links',
    model_name: 'fixture-model', ext_info: { knowledge_space_name: '原始', knowledge_space_id: 7 },
  };
  await i18n.changeLanguage('vi');
  await act(() => hook.result.current.sendMessage(request));
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({
    ...request, ext_info: { ...request.ext_info, locale: 'vi' },
  });
  await i18n.changeLanguage('en');
  await act(() => hook.result.current.sendMessage(request));
  expect(JSON.parse(String(fetcher.mock.calls[1][1].body)).ext_info.locale).toBe('en');
  await act(() => hook.result.current.sendMessage({ ...request, ext_info: { ...request.ext_info, locale: 'vi' } }));
  expect(JSON.parse(String(fetcher.mock.calls[2][1].body)).ext_info.locale).toBe('vi');
  expect(request.ext_info).not.toHaveProperty('locale');
});
