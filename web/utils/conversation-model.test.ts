import { expect, it } from 'vitest';
import { conversationModelFromHistory } from './conversation-model';

it('uses the newest view turn, not an earlier model or a later human placeholder', () => {
  expect(conversationModelFromHistory([
    { role: 'view', order: 2, model_name: 'april' },
    { role: 'view', order: 1, model_name: 'february' },
    { role: 'human', order: 3, model_name: 'global-default' },
  ])).toBe('april');
});

it('does not invent a model for an unknown latest turn', () => {
  expect(conversationModelFromHistory([
    { role: 'view', order: 1, model_name: 'older' },
    { role: 'view', order: 2 },
  ])).toBe('');
  expect(conversationModelFromHistory([])).toBe('');
});
