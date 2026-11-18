import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import i18n from '@/app/i18n';
import ReferenceCount from './ReferenceCount';

afterEach(async () => { cleanup(); await i18n.changeLanguage('vi'); });

it.each([
  ['vi', '28 trích đoạn tham chiếu', 'không phải số tài liệu độc lập'],
  ['en', '28 reference excerpts', 'not independent documents'],
  ['zh', '28 段引用依据', '不是独立文档数量'],
])('labels reference entries without claiming independent documents in %s', async (locale, label, explanation) => {
  await act(() => i18n.changeLanguage(locale));
  render(<ReferenceCount count={28} />);
  expect(screen.getByText(label).title).toContain(explanation);
});

it('gives compact counts the same accessible meaning and handles zero/singular', async () => {
  await act(() => i18n.changeLanguage('vi'));
  const view = render(<ReferenceCount count={28} compact />);
  expect(screen.getByLabelText('28 trích đoạn tham chiếu').textContent).toBe('28');
  view.rerender(<ReferenceCount count={1} compact />);
  expect(screen.getByLabelText('1 trích đoạn tham chiếu').textContent).toBe('1');
  view.rerender(<ReferenceCount count={0} />);
  expect(screen.getByText('0 trích đoạn tham chiếu').title).toContain('cùng một tài liệu');
});
