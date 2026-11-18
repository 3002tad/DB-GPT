const TYPES = new Set([
  'response_line_chart', 'response_bar_chart', 'response_pie_chart', 'response_donut_chart',
  'response_scatter_chart', 'response_bubble_chart', 'response_area_chart',
  'response_heatmap_chart', 'response_table',
]);

export interface NativeChartPayload {
  renderer: 'vis-db-chart';
  type: string;
  data: Record<string, any>[];
  sql: string;
  title?: string;
  describe?: string;
  artifact_id?: string;
  input_artifact_ids?: string[];
}

export function nativeChartPayload(value: any): NativeChartPayload | null {
  if (!value || typeof value !== 'object' || !TYPES.has(value.type)
    || !Array.isArray(value.data) || typeof value.sql !== 'string'
    || value.data.some((row: unknown) => !row || typeof row !== 'object' || Array.isArray(row))) return null;
  return { ...value, renderer: 'vis-db-chart' };
}

/** Recover only the native chart protocol in recorded tool output, not prose. */
export function nativeChartsFromOutput(output: { output_type: string; content?: any }): NativeChartPayload[] {
  if (output.output_type === 'chart') {
    const payload = nativeChartPayload(output.content);
    return payload ? [payload] : [];
  }
  if (!['markdown', 'text'].includes(output.output_type) || typeof output.content !== 'string') return [];
  const found: NativeChartPayload[] = [];
  for (const match of output.content.matchAll(/```vis-db-chart\s*\n?([\s\S]*?)```/g)) {
    try {
      const payload = nativeChartPayload(JSON.parse(match[1]));
      if (payload) found.push(payload);
    } catch { /* A malformed/truncated historical block remains ordinary text. */ }
  }
  return found;
}
