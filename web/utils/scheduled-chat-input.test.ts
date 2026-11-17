import { describe, expect, it } from 'vitest';
import { scheduledChatInput } from './scheduled-chat-input';

describe('scheduled conversation snapshot', () => {
  it('keeps single-turn prompts unchanged', () => {
    expect(scheduledChatInput('Count sessions', [{ role: 'human', context: 'Count sessions' }])).toBe('Count sessions');
  });
  it('preserves referents without including the current answer or private progress', () => {
    const input = scheduledChatInput('Compare that month', [
      { role: 'human', context: 'Find the highest month for facebook and zalo' },
      { role: 'view', context: 'December has the most sessions' },
      { role: 'view', context: 'private unfinished progress', thinking: true },
      { role: 'human', context: 'Compare that month' },
      { role: 'view', context: 'current answer must be regenerated' },
    ]);
    expect(input).toContain('facebook and zalo');
    expect(input).toContain('December');
    expect(input).toContain('recompute all numbers');
    expect(input.match(/Compare that month/g)).toHaveLength(1);
    expect(input).not.toContain('private unfinished progress');
    expect(input).not.toContain('current answer must be regenerated');
  });
});
