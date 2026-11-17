/** Freeze visible conversation context, never private reasoning/tool envelopes.
 * Historical answers are reference text, not evidence for a new execution.
 */
export function scheduledChatInput(
  userInput: string,
  messages: readonly { role: string; context: string; thinking?: boolean }[],
): string {
  const current = messages.map(m => m.role).lastIndexOf('human');
  const previous = messages.slice(0, Math.max(current, 0))
    .filter(m => !m.thinking && m.context.trim() && ['human', 'view'].includes(m.role));
  if (!previous.length) return userInput;
  return [
    'Saved conversation context (reference only; recompute all numbers from current tools/data, not historical answers):',
    ...previous.map(m => `${m.role === 'human' ? 'User' : 'Previous answer'}:\n${m.context}`),
    'Current scheduled request:',
    userInput,
  ].join('\n\n');
}
