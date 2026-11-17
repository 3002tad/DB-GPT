/** Selection changes may replace a bare shortcut, never an authored question. */
export function skillDraft(current: string, selectedName: string, enabled: boolean): string {
  const shortcutOnly = /^\/[\w.-]+$/.test(current.trim());
  if (current.trim() && !shortcutOnly) return current;
  return enabled ? `/${selectedName} ` : current.trim() === `/${selectedName}` ? '' : current;
}
