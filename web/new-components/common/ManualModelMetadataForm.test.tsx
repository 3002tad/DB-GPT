import i18n from '@/app/i18n';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import ManualModelMetadataForm from './ManualModelMetadataForm';

beforeEach(async () => {
  vi.spyOn(window, 'getComputedStyle').mockReturnValue({ getPropertyValue: () => '', overflow: 'visible', overflowX: 'visible', overflowY: 'visible' } as unknown as CSSStyleDeclaration);
  await i18n.changeLanguage('vi');
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('submits explicit numeric limits and provenance while leaving function calling unspecified', async () => {
  const save = vi.fn().mockResolvedValue(true);
  const view = render(<ManualModelMetadataForm onSave={save} />);
  fireEvent.change(screen.getByLabelText('Cửa sổ ngữ cảnh (token)'), { target: { value: '256000' } });
  fireEvent.change(screen.getByLabelText('Đầu ra tối đa (token)'), { target: { value: '16000' } });
  fireEvent.change(screen.getByLabelText('Nguồn tham khảo (tài liệu hoặc console nhà cung cấp)'), { target: { value: 'Provider console' } });
  fireEvent.change(screen.getByLabelText('Ngày kiểm tra'), { target: { value: '2026-11-18' } });
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledWith({ context_length: 256000, max_output_length: 16000, function_calling: null, reference: 'Provider console', checked_at: '2026-11-18' }));
});

it('blocks output above context and declarations without provenance', async () => {
  const save = vi.fn();
  const view = render(<ManualModelMetadataForm onSave={save} />);
  fireEvent.change(screen.getByLabelText('Cửa sổ ngữ cảnh (token)'), { target: { value: '1000' } });
  fireEvent.change(screen.getByLabelText('Đầu ra tối đa (token)'), { target: { value: '2000' } });
  fireEvent.submit(view.container.querySelector('form')!);
  expect(await screen.findByText('Đầu ra không được vượt cửa sổ ngữ cảnh')).toBeTruthy();
  expect(screen.getAllByText('Cần nguồn tham khảo và ngày kiểm tra cho giá trị khai báo').length).toBe(2);
  expect(save).not.toHaveBeenCalled();
});

it('allows an entirely unspecified declaration without silently filling a model window', async () => {
  const save = vi.fn().mockResolvedValue(true);
  const view = render(<ManualModelMetadataForm onSave={save} />);
  fireEvent.submit(view.container.querySelector('form')!);
  await waitFor(() => expect(save).toHaveBeenCalledWith({ context_length: null, max_output_length: null, function_calling: null, reference: null, checked_at: null }));
});
