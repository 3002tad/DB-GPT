/** File cards come from typed producer outputs, not filenames in prose/code. */
export function generatedFileOutput(output: { output_type: string; content?: any }) {
  if (output.output_type !== 'file') return null;
  const payload = output.content;
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return null;
  if (payload.existence_verified === false) return null;
  const rawPath = payload.file_path || payload.path;
  const path = typeof rawPath === 'string' && rawPath.trim() && !/^(undefined|null)$/i.test(rawPath.trim())
    ? rawPath.trim() : undefined;
  const name = payload.name || payload.file_name || path?.replace(/\\/g, '/').split('/').pop();
  if (typeof name !== 'string' || !name.trim()) return null;
  if (!path && typeof payload.content !== 'string') return null;
  return { ...payload, name, file_path: path };
}
