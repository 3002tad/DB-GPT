import type { DashboardVisualization } from '@/types/dashboard';

export const visualizationEnglish: Record<DashboardVisualization, string> = {
  kpi: 'KPI card', line: 'Line chart', area: 'Area chart', column: 'Column chart',
  bar: 'Bar chart', stacked_column: 'Stacked column chart', pie: 'Pie chart',
  donut: 'Donut chart', scatter: 'Scatter plot', dual_axis: 'Dual-axis chart',
  heatmap: 'Heatmap', cohort: 'Cohort retention matrix', gauge: 'Gauge', funnel: 'Funnel',
  treemap: 'Treemap', radar: 'Radar chart', waterfall: 'Waterfall chart',
  geo_map: 'Geographic map', table: 'Detail table',
};
