import { afterEach, describe, expect, it, vi } from 'vitest';
import i18n from '@/app/i18n';
import { notification } from 'antd';
import { apiInterceptors } from './interceptors';

vi.mock('antd', () => ({ notification: { error: vi.fn() } }));
afterEach(async () => { vi.clearAllMocks(); await i18n.changeLanguage('vi'); });

describe('API notification locale', () => {
  it('localizes the heading but preserves source error details and response shape', async () => {
    const body = { success: false, err_code: 'SOURCE_TEST', err_msg: 'Original source error', data: null };
    const result = await apiInterceptors(Promise.resolve({ data: body } as any));
    expect(notification.error).toHaveBeenCalledWith({ message: 'Yêu cầu thất bại', description: 'Original source error' });
    expect(result[2]).toBe(body);
  });
  it('uses the active language for generic errors and leaves successful responses untouched', async () => {
    await i18n.changeLanguage('en');
    await apiInterceptors(Promise.resolve({ data: { success: false } } as any));
    expect(notification.error).toHaveBeenCalledWith({ message: 'Request error', description: 'Service unavailable. Please try again later.' });
    vi.mocked(notification.error).mockClear();
    const result = await apiInterceptors(Promise.resolve({ data: { success: true, data: { count: 42 } } } as any));
    expect(result[1]).toEqual({ count: 42 });
    expect(notification.error).not.toHaveBeenCalled();
  });
});
