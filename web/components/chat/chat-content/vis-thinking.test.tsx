import { fireEvent, render, screen } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { VisThinking } from './vis-thinking';

vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: () => 'Quá trình suy luận' }) }));

it('keeps provider reasoning collapsed while the final answer remains visible', () => {
  render(<><VisThinking content='Synthetic reasoning fixture' /><p>Kết quả: 42</p></>);
  expect(screen.queryByText('Synthetic reasoning fixture')).toBeNull();
  expect(screen.getByText('Kết quả: 42')).toBeTruthy();
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
});

it('preserves explicit expansion and collapse as stream content grows', () => {
  const view = render(<VisThinking content='Fixture A' />);
  view.rerender(<VisThinking content='Fixture A plus B' />);
  expect(screen.queryByText('Fixture A plus B')).toBeNull();
  fireEvent.click(screen.getByRole('button'));
  expect(screen.getByText('Fixture A plus B')).toBeTruthy();
  view.rerender(<VisThinking content='Fixture A plus B plus C' />);
  expect(screen.getByText('Fixture A plus B plus C')).toBeTruthy();
  const button = screen.getByRole('button');
  expect(document.getElementById(button.getAttribute('aria-controls')!)).toBeTruthy();
  fireEvent.click(button);
  expect(screen.queryByText('Fixture A plus B plus C')).toBeNull();
});

it('starts collapsed again when a saved conversation is mounted', () => {
  const first = render(<VisThinking content='Saved fixture' />);
  fireEvent.click(screen.getByRole('button'));
  first.unmount();
  render(<VisThinking content='Saved fixture' />);
  expect(screen.queryByText('Saved fixture')).toBeNull();
  expect(screen.getByRole('button').getAttribute('aria-expanded')).toBe('false');
});

it('handles an empty reasoning chunk and keeps panels independent', () => {
  render(<><VisThinking content='' /><VisThinking content='Second fixture' /></>);
  const buttons = screen.getAllByRole('button');
  expect(buttons[0].getAttribute('aria-controls')).not.toBe(buttons[1].getAttribute('aria-controls'));
  fireEvent.click(buttons[0]);
  expect(buttons[1].getAttribute('aria-expanded')).toBe('false');
  expect(screen.queryByText('Second fixture')).toBeNull();
});
