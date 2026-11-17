/** Leading display labels do not authorize or select a source. */
export function missingContextSelections(input: string, database?: string | null, knowledge?: string | null): string[] {
  const prefix = input.match(/^\s*((?:\[(?:Database|Knowledge):[^\]\r\n]+\]\s*)+)/i)?.[1] || '';
  const missing: string[] = [];
  if (/\[Database:/i.test(prefix) && !database) missing.push('database');
  if (/\[Knowledge:/i.test(prefix) && !knowledge) missing.push('knowledge');
  return missing;
}
