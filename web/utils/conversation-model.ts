/** Read the last persisted turn's model, never infer it from generated prose. */
export function conversationModelFromHistory(messages: { role: string; model_name?: string; order?: number }[]): string {
  const turns = messages.filter(message => message.role === 'view');
  const latest = turns.reduce<(typeof turns)[number] | undefined>((last, message) =>
    !last || (message.order ?? 0) >= (last.order ?? 0) ? message : last, undefined);
  const model = latest?.model_name;
  return typeof model === 'string' && model.length <= 256 ? model.trim() : '';
}
