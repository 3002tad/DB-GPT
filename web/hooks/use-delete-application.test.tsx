import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import '@/app/i18n';
import { delApp } from '@/client/api';
import { useDeleteApplication } from './use-delete-application';

vi.mock('@/client/api', () => ({ delApp: vi.fn() }));
const deleted = vi.fn();
function Harness() {
  const confirm = useDeleteApplication(deleted);
  return <button onClick={() => confirm({ app_code: 'test-app', app_name: 'Test draft' })}>Open delete</button>;
}
function open() {
  render(<App><Harness /></App>);
  fireEvent.click(screen.getByText('Open delete'));
}
beforeEach(() => { vi.mocked(delApp).mockReset(); deleted.mockReset(); });
afterEach(cleanup);

describe('Application deletion confirmation', () => {
  it('shows the exact application and cancellation never calls the API', async () => {
    open();
    expect(await screen.findByText(/Test draft/)).not.toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Hủy' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(delApp).not.toHaveBeenCalled();
    expect(deleted).not.toHaveBeenCalled();
  });
  it('deletes only the selected application and refreshes after success', async () => {
    vi.mocked(delApp).mockResolvedValue({ data: { success: true } } as any);
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
    expect(delApp).toHaveBeenCalledExactlyOnceWith({ app_code: 'test-app' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });
  it.each(['business', 'network'])('keeps confirmation open on %s failure and supports retry', async kind => {
    if (kind === 'business') vi.mocked(delApp).mockResolvedValueOnce({ data: { success: false } } as any);
    else vi.mocked(delApp).mockRejectedValueOnce(new Error('Network failed'));
    open();
    fireEvent.click(await screen.findByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(delApp).toHaveBeenCalledTimes(1));
    expect(deleted).not.toHaveBeenCalled();
    expect(screen.getByRole('dialog')).not.toBeNull();
    vi.mocked(delApp).mockResolvedValueOnce({ data: { success: true } } as any);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Xóa' }).querySelector('.ant-btn-loading-icon')).toBeNull());
    fireEvent.click(screen.getByRole('button', { name: 'Xóa' }));
    await waitFor(() => expect(deleted).toHaveBeenCalledTimes(1));
  });
});
