import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import ConversationTokenBadge from './ConversationTokenBadge';
const state = vi.hoisted(() => ({ total: null as number | null, complete: false, calls: 0, failed: false }));
vi.mock('@/hooks/use-conversation-meters', () => ({ useConversationTokens: () => state }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: { language: 'vi' } }) }));
afterEach(cleanup);
it('renders a provider total, distinguishing partial and missing usage', () => {
  const view = render(<ConversationTokenBadge conversationId='chat' running={false} />);
  expect(screen.getByRole('status').textContent).toContain('— · Chưa đầy đủ');
  Object.assign(state, { total: 123456, complete: true });
  view.rerender(<ConversationTokenBadge conversationId='chat' running={false} />);
  expect(screen.getByRole('status').textContent).toBe('Đã dùng: 123.456 token');
  state.complete = false;
  view.rerender(<ConversationTokenBadge conversationId='chat' running={false} />);
  expect(screen.getByRole('status').textContent).toContain('123.456 token · Chưa đầy đủ');
  view.rerender(<ConversationTokenBadge conversationId={null} running={false} />);
  expect(screen.queryByRole('status')).toBeNull();
});
