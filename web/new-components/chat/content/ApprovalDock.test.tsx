import { fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { PendingApproval } from '@/utils/react-sse-parser';
import ApprovalDock from './ApprovalDock';

const { get } = vi.hoisted(() => ({ get: vi.fn() }));
vi.mock('@/client/api', () => ({ GET: get }));
vi.mock('@/app/funnelmetry-identity', () => ({ useFunnelmetryIdentity: () => ({ integrated: true, role: 'analyst' }) }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

const pending = {
  approval_id: 'review-1', conv_id: 'chat', tool: 'code', args_preview: '# short preview …',
  rule_id: 'code.static_sink', risk: 'confirm', memory_key: 'code: exact-hash', intent: ['Review script'],
} as PendingApproval;
afterEach(cleanup);

describe('approval complete argument review', () => {
  it('loads all arguments only on request and never approves by viewing', async () => {
    const resolve = vi.fn();
    const script = '# script\n'.repeat(100) + "print('<script>TAIL</script>')";
    get.mockResolvedValue({ data: { success: true, data: { approval_id: pending.approval_id, arguments: { code: script, timeout: 37 } } } });
    const { container } = render(<ApprovalDock approvals={[pending]} onResolve={resolve} />);
    expect(get).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('approval_details_show'));
    await waitFor(() => expect(container.textContent).toContain(script));
    expect(get).toHaveBeenCalledWith('/api/v1/chat/approval/review-1/details');
    expect(container.textContent).toContain('37');
    expect(container.querySelector('script')).toBeNull();
    expect(resolve).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText('approval_details_hide'));
    fireEvent.click(screen.getByText('approval_details_show'));
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('shows recoverable fetch errors and does not display another approval', async () => {
    get.mockResolvedValue({ data: { success: true, data: { approval_id: 'other', arguments: { code: 'OTHER_SCRIPT' } } } });
    render(<ApprovalDock approvals={[pending]} onResolve={vi.fn()} />);
    fireEvent.click(screen.getByText('approval_details_show'));
    await screen.findByRole('alert');
    expect(screen.queryByText('OTHER_SCRIPT')).toBeNull();
    get.mockRejectedValue(new Error('403'));
    fireEvent.click(screen.getByText('approval_details_show'));
    await waitFor(() => expect(get).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('alert').textContent).toBe('approval_details_error');
  });

  it('keeps once as default and makes exact code session scope explicit', () => {
    const resolve = vi.fn();
    render(<ApprovalDock approvals={[pending]} onResolve={resolve} />);
    expect(screen.queryByText('approval_scope_always')).toBeNull();
    fireEvent.click(screen.getByText('approval_allow'));
    expect(resolve).toHaveBeenLastCalledWith('review-1', 'approve', 'once');
    fireEvent.change(screen.getByRole('combobox'), { target: { value: 'session' } });
    expect(screen.getByText('approval_code_scope_hint')).toBeTruthy();
    expect(screen.getByText('approval_code_remember_hint')).toBeTruthy();
    fireEvent.click(screen.getByText('approval_allow'));
    expect(resolve).toHaveBeenLastCalledWith('review-1', 'approve', 'session');
  });
});
