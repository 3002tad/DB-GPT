import { act, fireEvent, render, screen } from '@testing-library/react';
import { expect, it } from 'vitest';
import i18n from '@/app/i18n';
import { useDashboardPaneResize } from './use-dashboard-pane-resize';

function Panes() {
  const pane = useDashboardPaneResize({
    libraryMode: 'components', settingsMode: 'visual', leftVisible: true, rightVisible: true, compact: false,
  });
  return <><div {...pane.separatorProps('left')} /><div {...pane.separatorProps('right')} /></>;
}

it('localizes accessible resize controls and retains keyboard sizing on language changes', async () => {
  await i18n.changeLanguage('vi');
  render(<Panes />);
  const left = screen.getByRole('separator', { name: 'Điều chỉnh độ rộng khung soạn thảo bên trái' });
  const width = Number(left.getAttribute('aria-valuenow'));
  fireEvent.keyDown(left, { key: 'ArrowRight' });
  expect(Number(left.getAttribute('aria-valuenow'))).toBeGreaterThan(width);
  expect(left.title).toContain('nhấp đúp');
  await act(() => i18n.changeLanguage('en'));
  expect(screen.getByRole('separator', { name: 'Resize the left editor pane' })).toBe(left);
  expect(screen.getByRole('separator', { name: 'Resize the right settings and SQL pane' })).toBeTruthy();
  expect(left.title).toContain('double-click');
  await act(() => i18n.changeLanguage('vi'));
});
