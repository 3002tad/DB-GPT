import { useUiText } from '@/hooks/use-ui-text';
import { visualizationEnglish } from './dashboard-visualization-english';
import {
  applyDashboardAnnotation,
  createDashboardAnnotation,
  generateDashboardAnnotationProposal,
  getDashboard,
  getDashboardJsonSchema,
  getLatestDashboardSnapshot,
  listDashboardAnnotations,
  previewDashboardWidget,
  publishDashboard,
  refreshDashboard,
  rejectDashboardAnnotation,
  resolveDashboardAnnotationIntents,
  resolveDashboardTarget,
  validateDashboard,
} from '@/client/api';
import { applyDashboardAnnotationBatch, createDashboardLiveShare } from '@/client/api/dashboard';
import { useQuestionSession } from '@/hooks/use-question-session';
import { dashboardAntdTokens, interfaceThemeVariables, statusTagStyle } from '@/lib/interface-tokens';
import { SELECTED_MODEL_STORAGE_KEY } from '@/lib/model-runtime';
import QuestionDock from '@/new-components/chat/content/QuestionDock';
import SaveAsScheduledTaskDrawer from '@/new-components/scheduled-task/SaveAsScheduledTaskDrawer';
import {
  DashboardAnnotationIntentResolution,
  DashboardAnnotationRecord,
  DashboardFilter,
  DashboardFilterType,
  DashboardLayoutItem,
  DashboardPublicationAggregation,
  DashboardPublicationBinding,
  DashboardRecord,
  DashboardSchemaV1,
  DashboardSelectionTarget,
  DashboardSnapshot,
  DashboardTargetResolution,
  DashboardVisualization,
  DashboardWidget,
  DashboardWidgetType,
  FilterParameterBinding,
} from '@/types/dashboard';
import {
  AppstoreOutlined,
  BgColorsOutlined,
  CalendarOutlined,
  CodeOutlined,
  CommentOutlined,
  DeleteOutlined,
  EditOutlined,
  EyeOutlined,
  FilterOutlined,
  FolderOpenOutlined,
  FullscreenExitOutlined,
  FullscreenOutlined,
  HistoryOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  MoreOutlined,
  PlusOutlined,
  RedoOutlined,
  ReloadOutlined,
  RightOutlined,
  SafetyCertificateOutlined,
  SaveOutlined,
  SettingOutlined,
  ShareAltOutlined,
  UndoOutlined,
} from '@ant-design/icons';
import Ajv2020, { ValidateFunction } from 'ajv/dist/2020';
import {
  Alert,
  theme as antdTheme,
  App,
  Button,
  ConfigProvider,
  DatePicker,
  Divider,
  Dropdown,
  Input,
  InputNumber,
  Segmented,
  Select,
  Space,
  Switch,
  Tag,
  Tooltip,
} from 'antd';
import axios from 'axios';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import DashboardAccessPanel from './DashboardAccessPanel';
import DashboardAnnotationOverlay, { DashboardAnnotationSelection } from './DashboardAnnotationOverlay';
import DashboardAnnotationTray from './DashboardAnnotationTray';
import DashboardAnomalyRuleEditor from './DashboardAnomalyRuleEditor';
import DashboardArtifactPanel from './DashboardArtifactPanel';
import DashboardAssistantConversation from './DashboardAssistantConversation';
import DashboardCoverCapture from './DashboardCoverCapture';
import DashboardFilters from './DashboardFilters';
import { DashboardLayoutTemplatePicker } from './DashboardLayoutTemplates';
import DashboardLifecyclePanel from './DashboardLifecyclePanel';
import DashboardPublishDialog, {
  type DashboardPublishedLinks,
  type DashboardPublishMode,
} from './DashboardPublishDialog';
import DashboardQueryLogicPanel from './DashboardQueryLogicPanel';
import DashboardRenderer from './DashboardRenderer';
import DashboardThemePanel from './DashboardThemePanel';
import styles from './DashboardWorkspace.module.css';
import {
  auditDashboardTheme,
  DASHBOARD_PALETTES,
  DashboardPaletteId,
  dashboardThemeCssVariables,
  detectDashboardPalette,
  replacePaletteColor,
  resolveDashboardTheme,
} from './dashboard-appearance';
import {
  buildDashboardAssistantContext,
  buildDashboardAssistantPrompt,
  DashboardAnnotationDraft,
  makeDashboardAnnotationDraft,
  resolveDashboardAnnotationDrafts,
} from './dashboard-assistant';
import { sendableAnnotations, useDashboardAssistantSession } from './dashboard-assistant-session';
import { runDashboardAssistant } from './dashboard-assistant-stream';
import { useDashboardCollaboration } from './dashboard-collaboration';
import {
  clearDashboardLocalDraft,
  readDashboardLocalDraft,
  writeDashboardLocalDraft,
} from './dashboard-draft-recovery';
import { useDashboardSchemaHistory } from './dashboard-editor-history';
import {
  hasConfiguredDashboardWidgets,
  isWidgetQueryUnconfigured,
  makeUnconfiguredVisualizationWidget,
  normalizeUnconfiguredVisualizationWidget,
  updateWidgetOutputFields,
} from './dashboard-editor-model';
import { describeDashboardError, groupMissingPublicationBindings } from './dashboard-errors';
import {
  buildDashboardFilterFieldCandidates,
  buildDashboardFilterParameterCandidates,
  normalizeDashboardFilterParameter,
  recommendDashboardDateFilterParameters,
  recommendDashboardFilterParameter,
  sqlUsesNamedParameter,
} from './dashboard-filter-config';
import { compactDashboardLayout, recommendedDashboardLayout } from './dashboard-layout';
import { applyDashboardLayoutTemplate, getDashboardLayoutTemplate } from './dashboard-layout-templates';
import {
  initialDashboardFilterValues,
  refreshDashboardFilterValues,
  scheduleDashboardFilterValues,
} from './dashboard-relative-date';
import { LAYOUT_TEMPLATES_ENABLED } from './dashboard-release-features';
import { useDashboardPaneResize } from './use-dashboard-pane-resize';

interface DashboardEditorProps {
  initialRecord: DashboardRecord;
  initialPanel?: 'access' | 'lifecycle' | 'schedule' | null;
  mode?: 'embedded' | 'standalone';
  focused?: boolean;
  onFocusChange?: (focused: boolean) => void;
  onRecordChange?: (record: DashboardRecord) => void;
  onSubmitAnnotation?: (
    annotation: DashboardAnnotationRecord,
    modelPrompt: string,
    visiblePrompt?: string,
  ) => void | Promise<void>;
}

type WidgetSettingsMode = 'visual' | 'query';
type WorkspaceMode = 'edit' | 'preview';
type LibraryMode = 'components' | 'assistant';

const visualizationNames: Record<DashboardVisualization, string> = {
  kpi: 'KPI 指标卡',
  line: '折线图',
  area: '面积图',
  column: '竖向柱状图',
  bar: '横向条形图',
  stacked_column: '堆叠柱状图',
  pie: '饼图',
  donut: '环形图',
  scatter: '散点图',
  dual_axis: '双轴组合图',
  heatmap: '热力图',
  cohort: '客户留存矩阵',
  gauge: '仪表盘',
  funnel: '漏斗图',
  treemap: '矩形树图',
  radar: '雷达图',
  waterfall: '瀑布图',
  geo_map: '地理分布图',
  table: '明细表',
};

const validationIssueMessage = (issue: { code: string; message: string }) => {
  if (issue.code === 'publication_binding_required') {
    return '有组件还不能响应分享页筛选。请打开该组件的“SQL 与数据设置”，补全分享页筛选数据绑定后再发布。';
  }
  return issue.message;
};

const publicationAggregationOptions: { value: DashboardPublicationAggregation; label: string }[] = [
  { value: 'sum', label: '求和' },
  { value: 'average', label: '平均值' },
  { value: 'count', label: '计数' },
  { value: 'count_distinct', label: '去重计数' },
  { value: 'minimum', label: '最小值' },
  { value: 'maximum', label: '最大值' },
  { value: 'first', label: '第一项' },
  { value: 'ratio', label: '比率（分子/分母）' },
];
const aggregationEnglish: Record<DashboardPublicationAggregation, string> = {
  sum: 'Sum', average: 'Average', count: 'Count', count_distinct: 'Distinct count',
  minimum: 'Minimum', maximum: 'Maximum', first: 'First', ratio: 'Ratio (numerator/denominator)',
};
const paletteEnglish: Record<string, string> = {
  businessBlue: 'Business blue', deepNavy: 'Deep blue', tealOrange: 'Teal and orange',
  violet: 'Violet', executive: 'Executive', monochrome: 'Monochrome',
};

const widgetVisualization = (widget: DashboardWidget): DashboardVisualization => {
  if (widget.presentation?.visualization) return widget.presentation.visualization;
  if (widget.type === 'bar') return 'column';
  if (widget.type === 'pie') return 'donut';
  return widget.type;
};

const makeFilter = (type: DashboardFilterType): DashboardFilter => {
  const id = `${type}-${Date.now().toString(36)}`;
  const labels: Record<DashboardFilterType, string> = {
    date_range: '日期范围',
    select: '单选筛选',
    multi_select: '多选筛选',
    text: '文本搜索',
    number_range: '数值范围',
  };
  return {
    id,
    type,
    label: labels[type],
    field: type === 'date_range' ? 'date' : type === 'number_range' ? 'value' : 'field',
    default: type === 'multi_select' ? [] : type === 'number_range' ? [null, null] : null,
    options: [],
  };
};

const nextLayout = (schema: DashboardSchemaV1, widget: DashboardWidget): DashboardLayoutItem => {
  const bottom = schema.layouts.desktop.reduce((max, item) => Math.max(max, item.y + item.h), 0);
  return {
    widget_id: widget.id,
    x: 0,
    y: bottom,
    w: widget.type === 'kpi' ? 4 : widget.type === 'table' ? 12 : 6,
    h: widget.type === 'kpi' ? 3 : 7,
    min_w: widget.type === 'kpi' ? 3 : 4,
    min_h: 3,
  };
};

const sameDesktopLayout = (left: DashboardLayoutItem[], right: DashboardLayoutItem[]) => {
  if (left.length !== right.length) return false;
  const normalized = (items: DashboardLayoutItem[]) =>
    items
      .map(item => ({
        widget_id: item.widget_id,
        x: item.x,
        y: item.y,
        w: item.w,
        h: item.h,
        min_w: item.min_w ?? null,
        min_h: item.min_h ?? null,
        max_w: item.max_w ?? null,
        max_h: item.max_h ?? null,
      }))
      .sort((a, b) => a.widget_id.localeCompare(b.widget_id));
  return JSON.stringify(normalized(left)) === JSON.stringify(normalized(right));
};

export default function DashboardEditor({
  initialRecord,
  initialPanel = null,
  mode = 'standalone',
  focused = false,
  onFocusChange,
  onRecordChange,
  onSubmitAnnotation,
}: DashboardEditorProps) {
  const tr = useUiText();
  const visualizationLabel = (type: DashboardVisualization) => tr(visualizationNames[type], visualizationEnglish[type]);
  const { message, modal } = App.useApp();
  const { warning: warnInitialDataLoad } = message;
  const publicationErrorRef = useRef<{ destroy: () => void } | null>(null);
  const [record, updateRecord] = useState(initialRecord);
  const recordRef = useRef(initialRecord);
  const setRecord = useCallback((next: DashboardRecord) => {
    // HTTP acknowledgements can arrive after a newer collaboration update,
    // including before React commits that update to the screen.
    if (next.current_revision < recordRef.current.current_revision) return false;
    recordRef.current = next;
    updateRecord(next);
    return true;
  }, []);
  const { schema, setSchema, resetSchema, acknowledgeSave, undo, redo, canUndo, canRedo } = useDashboardSchemaHistory(
    initialRecord.schema,
  );
  const schemaRef = useRef(schema);
  useEffect(() => {
    schemaRef.current = schema;
  }, [schema]);
  const [snapshot, setSnapshot] = useState<DashboardSnapshot | null>(null);
  const filterRequestRef = useRef(0);
  const filterTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [filters, setFilters] = useState<Record<string, unknown>>(() =>
    initialDashboardFilterValues(initialRecord.schema.filters),
  );
  const [selectedWidgetId, setSelectedWidgetId] = useState<string | null>(initialRecord.schema.widgets[0]?.id || null);
  const [selectedFilterId, setSelectedFilterId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [schedulePanelOpen, setSchedulePanelOpen] = useState(initialPanel === 'schedule');
  const [lifecyclePanelOpen, setLifecyclePanelOpen] = useState(initialPanel === 'lifecycle');
  const [publishPanelOpen, setPublishPanelOpen] = useState(false);
  const [accessPanelOpen, setAccessPanelOpen] = useState(initialPanel === 'access');
  const [artifactPanelOpen, setArtifactPanelOpen] = useState(false);
  const [layoutPickerOpen, setLayoutPickerOpen] = useState(false);
  const [loadingWidgetIds, setLoadingWidgetIds] = useState<Set<string>>(new Set());
  const [clientValidator, setClientValidator] = useState<ValidateFunction | null>(null);
  const [compactViewport, setCompactViewport] = useState(false);
  const [wideLibraryCollapsed, setWideLibraryCollapsed] = useState(mode === 'embedded');
  const [compactLibraryCollapsed, setCompactLibraryCollapsed] = useState(true);
  const libraryCollapsed = compactViewport ? compactLibraryCollapsed : wideLibraryCollapsed;
  const setLibraryCollapsed = (value: boolean | ((current: boolean) => boolean)) =>
    compactViewport ? setCompactLibraryCollapsed(value) : setWideLibraryCollapsed(value);
  const [libraryMode, setLibraryMode] = useState<LibraryMode>('components');
  const [chartSearch, setChartSearch] = useState('');
  const [chartPickerOpen, setChartPickerOpen] = useState(false);
  const [standaloneFocused, setStandaloneFocused] = useState(false);
  const focusManualEditor = () => {
    if (mode === 'embedded') onFocusChange?.(true);
    else setStandaloneFocused(true);
    setAnnotationMode(false);
    setLibraryMode('components');
    if (window.matchMedia('(max-width: 1060px)').matches) setLibraryCollapsed(true);
  };
  useEffect(() => {
    if (mode !== 'standalone') return;
    document.body.dataset.dashboardFocus = String(standaloneFocused);
    return () => {
      delete document.body.dataset.dashboardFocus;
    };
  }, [mode, standaloneFocused]);
  const { session: assistantSession, setSession: setAssistantSession } = useDashboardAssistantSession(record.id);
  const { pendingQuestion, handleQuestionEvent, clearQuestions, replyQuestion, rejectQuestion } = useQuestionSession();
  const annotationDrafts = assistantSession.drafts;
  const annotationAttachments = sendableAnnotations(assistantSession);
  const [annotationTrayOpen, setAnnotationTrayOpen] = useState(false);
  const [assistantRunning, setAssistantRunning] = useState(false);
  const [assistantStatus, setAssistantStatus] = useState('');
  const assistantAbortRef = useRef<AbortController | null>(null);
  const assistantRetryRef = useRef<{ text: string; drafts: DashboardAnnotationDraft[]; context?: string } | null>(null);
  const assistantAvailable = mode === 'standalone' || Boolean(onSubmitAnnotation);
  useEffect(() => () => assistantAbortRef.current?.abort(), []);
  const intentResolutionRef = useRef<{ key: string; resolution: DashboardAnnotationIntentResolution } | null>(null);
  const persistedAnnotationsRef = useRef(new Map<string, DashboardAnnotationRecord>());
  const [wideSettingsCollapsed, setWideSettingsCollapsed] = useState(mode === 'embedded');
  const [compactSettingsCollapsed, setCompactSettingsCollapsed] = useState(true);
  const settingsCollapsed = compactViewport ? compactSettingsCollapsed : wideSettingsCollapsed;
  const setSettingsCollapsed = (value: boolean | ((current: boolean) => boolean)) =>
    compactViewport ? setCompactSettingsCollapsed(value) : setWideSettingsCollapsed(value);
  const [annotationMode, setAnnotationMode] = useState(false);
  const [annotationSelection, setAnnotationSelection] = useState<DashboardAnnotationSelection | null>(null);
  const [annotations, setAnnotations] = useState<DashboardAnnotationRecord[]>([]);
  const [applyingAnnotationId, setApplyingAnnotationId] = useState<string | null>(null);
  const [filterParameterDrafts, setFilterParameterDrafts] = useState<Record<string, string>>({});
  const [widgetSettingsMode, setWidgetSettingsMode] = useState<WidgetSettingsMode>('visual');
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>('edit');
  const paneResize = useDashboardPaneResize({
    libraryMode,
    settingsMode: widgetSettingsMode,
    leftVisible: workspaceMode === 'edit' && !libraryCollapsed,
    rightVisible: workspaceMode === 'edit' && !settingsCollapsed,
    compact: compactViewport,
  });
  const restoreBrowsingLayout = () => {
    setSettingsCollapsed(true);
    if (window.matchMedia('(max-width: 1060px)').matches) setLibraryCollapsed(true);
    if (mode === 'embedded') onFocusChange?.(false);
    else setStandaloneFocused(false);
  };
  const recoveryCheckedRef = useRef(false);
  const initialDataLoadRecordRef = useRef<string | null>(null);
  const manualFilterIdsRef = useRef(new Set<string>());
  const queryEditorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const narrowViewport = window.matchMedia('(max-width: 1060px)');
    // Keep desktop and compact panel preferences separately. A window transition
    // or full-page capture must not overwrite the user's desktop panel choice.
    const onViewportChange = () => setCompactViewport(narrowViewport.matches);
    onViewportChange();
    narrowViewport.addEventListener('change', onViewportChange);
    return () => narrowViewport.removeEventListener('change', onViewportChange);
  }, []);

  useEffect(() => {
    onRecordChange?.(record);
  }, [onRecordChange, record]);

  const hasPendingAnnotations = useMemo(() => annotations.some(item => item.status === 'pending'), [annotations]);
  const assistantProposals = annotations.filter(
    item =>
      assistantSession.annotationIds.includes(item.id) &&
      item.status === 'proposed' &&
      item.base_revision === record.current_revision,
  );

  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await listDashboardAnnotations(record.id);
        if (active) setAnnotations(response.data.data);
      } catch {
        // The editor remains usable if annotation history is temporarily unavailable.
      }
    };
    void load();
    const timer = window.setInterval(() => {
      if (annotationMode || hasPendingAnnotations || assistantRunning) void load();
    }, 2500);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [annotationMode, assistantRunning, hasPendingAnnotations, record.id]);

  const selectedWidget = useMemo(
    () => schema.widgets.find(widget => widget.id === selectedWidgetId) || null,
    [schema.widgets, selectedWidgetId],
  );
  const selectedVisualization = selectedWidget ? widgetVisualization(selectedWidget) : null;
  const selectedOutputFieldOptions = useMemo(
    () =>
      selectedWidget?.query.output_fields.map(field => ({
        label: field.label || field.name,
        value: field.name,
      })) || [],
    [selectedWidget],
  );
  const selectedPublicationFieldOptions = useMemo(
    () =>
      selectedWidget?.publication?.query.output_fields.map(field => ({
        label: field.label || field.name,
        value: field.name,
      })) || [],
    [selectedWidget],
  );
  const cartesianFieldLabels = useMemo(() => {
    if (!selectedVisualization) return null;
    if (selectedVisualization === 'geo_map')
      return { x: tr('国家字段（中英文名称或 ISO 代码）', 'Country field (Chinese/English name or ISO code)'), y: tr('数值字段', 'Value field'), series: '' };
    if (['funnel', 'treemap', 'radar', 'waterfall'].includes(selectedVisualization))
      return {
        x: selectedVisualization === 'funnel' ? tr('阶段字段（按查询顺序）', 'Stage field (query order)') : tr('分类或维度字段', 'Category or dimension field'),
        y: selectedVisualization === 'waterfall' ? tr('增减量字段', 'Change field') : tr('数值字段（相同单位）', 'Value field (same unit)'),
        series: '',
      };
    if (selectedVisualization === 'line' || selectedVisualization === 'area') {
      return { x: tr('X 轴（时间或分类）', 'X axis (time or category)'), y: tr('Y 轴（数值）', 'Y axis (value)'), series: tr('系列（可选）', 'Series (optional)') };
    }
    if (
      selectedVisualization === 'column' ||
      selectedVisualization === 'bar' ||
      selectedVisualization === 'stacked_column'
    ) {
      return { x: tr('分类字段', 'Category field'), y: tr('数值字段', 'Value field'), series: tr('系列或堆叠字段（可选）', 'Series or stack field (optional)') };
    }
    if (selectedVisualization === 'scatter') {
      return { x: tr('横轴数值', 'Horizontal value'), y: tr('纵轴数值', 'Vertical value'), series: tr('分组字段（可选）', 'Group field (optional)') };
    }
    if (selectedVisualization === 'dual_axis') {
      return { x: tr('横轴字段', 'Horizontal field'), y: tr('主数值字段', 'Primary value field'), series: tr('系列字段（可选）', 'Series field (optional)') };
    }
    return null;
  }, [selectedVisualization, tr]);
  const supportsTopN = Boolean(
    selectedVisualization && ['column', 'bar', 'stacked_column', 'pie', 'donut'].includes(selectedVisualization),
  );
  const supportsNumericFormatting = Boolean(selectedVisualization && selectedVisualization !== 'table');
  const selectedFilter = useMemo(
    () => schema.filters.find(filter => filter.id === selectedFilterId) || null,
    [schema.filters, selectedFilterId],
  );
  const filterFieldCandidates = useMemo(
    () => buildDashboardFilterFieldCandidates(schema, snapshot),
    [schema, snapshot],
  );
  const dateFilterFieldCandidates = useMemo(
    () =>
      filterFieldCandidates.filter(
        candidate =>
          candidate.dateRange || candidate.dataTypes.some(dataType => dataType === 'date' || dataType === 'datetime'),
      ),
    [filterFieldCandidates],
  );
  const filterParameterCandidates = useMemo(() => buildDashboardFilterParameterCandidates(schema), [schema]);
  const selectedDateParameterRecommendation = useMemo(
    () =>
      selectedFilter?.type === 'date_range'
        ? recommendDashboardDateFilterParameters(selectedFilter.id, selectedFilter.field, filterParameterCandidates)
        : null,
    [filterParameterCandidates, selectedFilter],
  );
  const filterScopes = useMemo(
    () =>
      Object.fromEntries(
        schema.filters.map(filter => [
          filter.id,
          schema.widgets
            .filter(widget => {
              if (Object.prototype.hasOwnProperty.call(widget.query.filter_parameters || {}, filter.id)) return true;
              return Boolean(
                widget.query.federation?.sources.some(source =>
                  Object.prototype.hasOwnProperty.call(source.filter_parameters || {}, filter.id),
                ),
              );
            })
            .map(widget => widget.title),
        ]),
      ),
    [schema.filters, schema.widgets],
  );
  const selectedFilterBoundWidgets = useMemo(() => {
    if (!selectedFilter) return [];
    return schema.widgets.filter(widget => {
      if (Object.prototype.hasOwnProperty.call(widget.query.filter_parameters || {}, selectedFilter.id)) return true;
      return Boolean(
        widget.query.federation?.sources.some(source =>
          Object.prototype.hasOwnProperty.call(source.filter_parameters || {}, selectedFilter.id),
        ),
      );
    });
  }, [schema.widgets, selectedFilter]);
  const isDirty = useMemo(() => JSON.stringify(schema) !== JSON.stringify(record.schema), [record.schema, schema]);
  const collaboration = useDashboardCollaboration({
    dashboardId: record.id,
    currentRecord: record,
    dirty: isDirty,
    onRemoteRecord: remote => {
      if (!setRecord(remote)) return;
      resetSchema(remote.schema);
      clearDashboardLocalDraft(remote.id);
      setSelectedWidgetId(current =>
        current && remote.schema.widgets.some(widget => widget.id === current)
          ? current
          : remote.schema.widgets[0]?.id || null,
      );
      setSelectedFilterId(current =>
        current && remote.schema.filters.some(filter => filter.id === current) ? current : null,
      );
    },
  });

  useEffect(() => {
    getDashboardJsonSchema()
      .then(response => {
        const validator = new Ajv2020({ allErrors: true, strict: false }).compile(response.data.data);
        setClientValidator(() => validator);
      })
      .catch(() => {
        // The server remains authoritative. A schema-endpoint outage must not hide
        // the editor, but save/publish will still be rejected by the backend.
      });
  }, []);

  useEffect(() => {
    if (initialDataLoadRecordRef.current === record.id) return;
    initialDataLoadRecordRef.current = record.id;
    let active = true;
    let settled = false;
    const initialFilters = initialDashboardFilterValues(record.schema.filters);

    const hasConfiguredWidgets = hasConfiguredDashboardWidgets(record.schema.widgets);
    if (record.status !== 'published' && !hasConfiguredWidgets) {
      return;
    }

    const loadInitialData = async () => {
      // Start after the effect has subscribed so loading state is never written
      // synchronously from the effect body.
      await Promise.resolve();
      if (!active) return;
      setRefreshing(true);
      setLoadingWidgetIds(
        new Set(record.schema.widgets.filter(widget => !isWidgetQueryUnconfigured(widget)).map(widget => widget.id)),
      );
      try {
        let response;
        if (hasConfiguredWidgets) {
          try {
            // The editor always renders the current draft schema. A published
            // snapshot can be older than the latest saved draft, so using it as
            // the primary data source would make newly saved widgets look empty.
            response =
              record.status === 'published' && !record.schema.dashboard.refresh_policy?.refresh_on_open
                ? await getLatestDashboardSnapshot(record.id)
                : await refreshDashboard(record.id, initialFilters);
          } catch (refreshError) {
            if (record.status !== 'published') throw refreshError;
            // Keep an already published dashboard readable when its live data
            // source is temporarily unavailable. The public page still reads
            // immutable snapshots only and never executes SQL.
            response = await getLatestDashboardSnapshot(record.id);
          }
        } else {
          response = await getLatestDashboardSnapshot(record.id);
        }
        if (!active) return;
        setSnapshot(response.data.data);
        setFilters(response.data.data.filters);
      } catch (error) {
        if (active) warnInitialDataLoad(describeDashboardError(error, tr('看板数据加载失败，请点击刷新重试', 'Failed to load dashboard data. Select Refresh to retry.')));
      } finally {
        if (active) {
          settled = true;
          setRefreshing(false);
          setLoadingWidgetIds(new Set());
        }
      }
    };
    void loadInitialData();
    return () => {
      active = false;
      // A save can replace the schema while this first request is pending.
      // Let the next effect load that saved schema instead of keeping a stale guard.
      if (!settled) initialDataLoadRecordRef.current = null;
    };
  }, [
    warnInitialDataLoad,
    tr,
    record.id,
    record.schema.dashboard.refresh_policy?.refresh_on_open,
    record.schema.filters,
    record.schema.widgets,
    record.status,
  ]);

  useEffect(() => {
    if (recoveryCheckedRef.current) return;
    recoveryCheckedRef.current = true;
    const localDraft = readDashboardLocalDraft(record.id);
    if (
      !localDraft ||
      localDraft.baseRevision !== record.current_revision ||
      JSON.stringify(localDraft.schema) === JSON.stringify(record.schema)
    ) {
      return;
    }
    modal.confirm({
      title: tr('发现未保存的本地草稿', 'Unsaved local draft found'),
      content: tr(`这份草稿保存于 ${new Date(localDraft.savedAt).toLocaleString()}。恢复后仍需点击“保存”才会写入服务器。`, `This draft was saved locally at ${new Date(localDraft.savedAt).toLocaleString()}. After restoring it, select Save to write it to the server.`),
      okText: tr('恢复草稿', 'Restore draft'),
      cancelText: tr('丢弃草稿', 'Discard draft'),
      onOk: () => setSchema(localDraft.schema),
      onCancel: () => clearDashboardLocalDraft(record.id),
    });
  }, [modal, record.current_revision, record.id, record.schema, setSchema, tr]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (isDirty) writeDashboardLocalDraft(record.id, record.current_revision, schema);
      else clearDashboardLocalDraft(record.id);
    }, 500);
    return () => window.clearTimeout(timer);
  }, [isDirty, record.current_revision, record.id, schema]);

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!isDirty) return;
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [isDirty]);

  useEffect(() => {
    const handleKeyboardHistory = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.key.toLowerCase() !== 'z') return;
      const target = event.target as HTMLElement | null;
      if (target?.isContentEditable || target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;
      event.preventDefault();
      if (event.shiftKey) redo();
      else undo();
    };
    window.addEventListener('keydown', handleKeyboardHistory);
    return () => window.removeEventListener('keydown', handleKeyboardHistory);
  }, [redo, undo]);

  const replaceWidget = (widgetId: string, update: (widget: DashboardWidget) => DashboardWidget) => {
    setSchema(current => ({
      ...current,
      widgets: current.widgets.map(widget => (widget.id === widgetId ? update(widget) : widget)),
    }));
  };

  const replaceFilter = (filterId: string, update: (filter: DashboardFilter) => DashboardFilter) => {
    setSchema(current => ({
      ...current,
      filters: current.filters.map(filter => (filter.id === filterId ? update(filter) : filter)),
    }));
  };

  const openWidgetQueryEditor = (widgetId: string) => {
    focusManualEditor();
    setSelectedWidgetId(widgetId);
    setSelectedFilterId(null);
    setSettingsCollapsed(false);
    setWidgetSettingsMode('query');
    window.setTimeout(() => {
      queryEditorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      queryEditorRef.current?.querySelector('textarea')?.focus();
    }, 0);
  };

  const validateInBrowser = (requireConfigured = false) => {
    if (requireConfigured) {
      const incomplete = schema.widgets.filter(isWidgetQueryUnconfigured);
      if (incomplete.length) {
        publicationErrorRef.current = modal.error({
          title: tr('仍有组件未配置查询', 'Some widgets have no configured query'),
          content: (
            <div>
              <p>{tr('发布前请完成：SQL → 输出字段 → 图表映射 → 校验并试运行。', 'Before publishing, complete SQL → output fields → chart mapping → validation and test run.')}</p>
              <p className='mt-2 text-xs text-[var(--app-muted)]'>
                {tr('未配置：', 'Not configured: ')}{incomplete.map(widget => widget.title).join(', ')}
              </p>
              <Button
                className='mt-3'
                onClick={() => {
                  openWidgetQueryEditor(incomplete[0].id);
                  publicationErrorRef.current?.destroy();
                }}
              >
                {tr('前往配置第一个组件', 'Configure the first widget')}
              </Button>
            </div>
          ),
        });
        return false;
      }
    }
    const themeIssues = auditDashboardTheme(schema.dashboard.theme).filter(issue => issue.level === 'error');
    if (themeIssues.length) {
      modal.error({
        title: '视觉主题需要调整',
        content: (
          <div className='space-y-1 text-sm'>
            {themeIssues.map(issue => (
              <p key={issue.code}>{issue.message}</p>
            ))}
          </div>
        ),
      });
      return false;
    }
    if (!clientValidator || clientValidator(schema)) return true;
    const detail = clientValidator.errors?.map(error => `${error.instancePath || '/'} ${error.message}`).join('\n');
    modal.error({ title: '看板结构需要修正', content: <pre className='whitespace-pre-wrap text-xs'>{detail}</pre> });
    return false;
  };

  const persistDraft = async (promoteToAsset = true) => {
    if (!isDirty && (record.asset_state !== 'generated' || !promoteToAsset)) return record;
    const schemaToSave = {
      ...schema,
      widgets: schema.widgets.map(normalizeUnconfiguredVisualizationWidget),
    };
    const saved = await collaboration.save(schemaToSave, record.current_revision, promoteToAsset);
    if (!setRecord(saved)) return recordRef.current;
    acknowledgeSave(schema, saved.schema);
    // The recovery effect clears only a clean draft and rebases pending edits
    // onto the acknowledged revision instead of deleting them here.
    return saved;
  };

  const showRevisionConflict = () => {
    modal.confirm({
      title: '检测到更新冲突',
      content:
        '这个看板已在另一个窗口被修改。重新加载会放弃本页尚未保存的改动；你也可以先取消，手动复制需要保留的内容。',
      okText: '重新加载',
      cancelText: '先不加载',
      onOk: () => window.location.reload(),
    });
  };

  const showRequestError = (error: unknown, fallback: string) => {
    if (axios.isAxiosError(error) && error.response?.status === 409) {
      showRevisionConflict();
      return;
    }
    message.error(describeDashboardError(error, fallback));
  };

  const handleSave = async () => {
    if (!validateInBrowser()) return;
    setSaving(true);
    try {
      await persistDraft();
      message.success(tr('草稿已保存', 'Draft saved'));
    } catch (error) {
      showRequestError(error, tr('保存失败', 'Save failed'));
    } finally {
      setSaving(false);
    }
  };

  const refreshWithFilters = async (activeFilters: Record<string, unknown>, reset = false) => {
    if (!validateInBrowser()) return;
    const sequence = ++filterRequestRef.current;
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    setRefreshing(true);
    try {
      const saved = await persistDraft(false);
      const resolvedFilters = refreshDashboardFilterValues(
        saved.schema.filters,
        activeFilters,
        undefined,
        manualFilterIdsRef.current,
      );
      setFilters(resolvedFilters);
      const response = await refreshDashboard(saved.id, resolvedFilters);
      if (sequence !== filterRequestRef.current) return;
      setSnapshot(response.data.data);
      const failed = Object.values(response.data.data.widgets).filter(item => item.error).length;
      failed
        ? message.warning(`${failed} 个组件刷新失败，其余组件已保留`)
        : message.success(reset ? '已恢复默认筛选并刷新数据' : '数据已刷新');
    } catch (error) {
      showRequestError(error, tr('刷新失败', 'Refresh failed'));
    } finally {
      if (sequence === filterRequestRef.current) setRefreshing(false);
    }
  };

  const handleRefresh = () => refreshWithFilters(filters);

  useEffect(
    () => () => {
      filterRequestRef.current += 1;
      manualFilterIdsRef.current.clear();
      if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    },
    [record.id],
  );

  const handleChangeFilters = (nextFilters: Record<string, unknown>, changedFilterId?: string) => {
    if (changedFilterId) manualFilterIdsRef.current.add(changedFilterId);
    setFilters(nextFilters);
    const sequence = ++filterRequestRef.current;
    if (filterTimerRef.current) clearTimeout(filterTimerRef.current);
    filterTimerRef.current = setTimeout(async () => {
      setRefreshing(true);
      try {
        const resolved = refreshDashboardFilterValues(
          schema.filters,
          nextFilters,
          undefined,
          manualFilterIdsRef.current,
        );
        setFilters(resolved);
        // Filtering an unsaved layout previews its current queries without saving unrelated edits.
        const nextSnapshot: DashboardSnapshot = isDirty
          ? {
              dashboard_id: record.id,
              refreshed_at: new Date().toISOString(),
              filters: resolved,
              widgets: Object.fromEntries(
                await Promise.all(
                  schema.widgets.map(async widget => {
                    const result = await previewDashboardWidget(record.id, widget.id, resolved, schema);
                    return [widget.id, result.data.data];
                  }),
                ),
              ),
            }
          : (await refreshDashboard(record.id, resolved)).data.data;
        if (sequence !== filterRequestRef.current) return;
        setSnapshot(nextSnapshot);
        if (Object.values(nextSnapshot.widgets).some(widget => widget.error))
          message.warning(tr('部分组件筛选失败，请查看组件内提示', 'Some widget filters failed. Check each widget.'));
      } catch (error) {
        if (sequence === filterRequestRef.current) showRequestError(error, tr('筛选失败，已保留上一次结果', 'Filtering failed; the previous results were retained'));
      } finally {
        if (sequence === filterRequestRef.current) setRefreshing(false);
      }
    }, 220);
  };

  const handleResetFilters = (nextFilters: Record<string, unknown>) => {
    manualFilterIdsRef.current.clear();
    setFilters(nextFilters);
    void refreshWithFilters(nextFilters, true);
  };

  const handlePreview = async (widgetId: string) => {
    setLoadingWidgetIds(current => new Set(current).add(widgetId));
    try {
      const response = await previewDashboardWidget(record.id, widgetId, filters, schema);
      setSnapshot(current => ({
        dashboard_id: record.id,
        refreshed_at: new Date().toISOString(),
        filters,
        widgets: { ...(current?.widgets || {}), [widgetId]: response.data.data },
      }));
    } catch (error) {
      showRequestError(error, tr('组件试运行失败', 'Widget test failed'));
    } finally {
      setLoadingWidgetIds(current => {
        const next = new Set(current);
        next.delete(widgetId);
        return next;
      });
    }
  };

  const handlePublish = async (mode: DashboardPublishMode): Promise<DashboardPublishedLinks | undefined> => {
    if (!validateInBrowser(true)) {
      setPublishPanelOpen(false);
      return;
    }
    setPublishing(true);
    try {
      let saved = await persistDraft();
      // A collaboration event or another clean browser tab may have advanced the
      // revision after this editor loaded. When this page has no local changes,
      // use the latest durable record instead of presenting a false conflict.
      if (!isDirty) {
        const latestResponse = await getDashboard(saved.id);
        const latest = latestResponse.data.data;
        if (latest.current_revision > saved.current_revision) {
          const currentSchema = schemaRef.current;
          const unchanged =
            JSON.stringify(currentSchema) === JSON.stringify(schema) ||
            JSON.stringify(currentSchema) === JSON.stringify(saved.schema);
          saved = latest;
          if (latest.current_revision >= recordRef.current.current_revision) {
            if (unchanged) {
              if (setRecord(latest)) acknowledgeSave(currentSchema, latest.schema);
            } else {
              collaboration.deferRemoteRecord(latest);
              message.warning(tr('发布期间的本地修改已保留，请确认后再加载远端版本', 'Local changes made during publication were retained. Review them before loading the remote version.'));
            }
          }
        }
      }
      if (recordRef.current.current_revision > saved.current_revision) saved = recordRef.current;
      const validation = await validateDashboard(saved.id, saved.schema, filters, true, true);
      const blockingIssues = validation.data.data.issues;
      const { missingWidgets: missingPublicationWidgets, otherIssues } = groupMissingPublicationBindings(
        blockingIssues,
        saved.schema.widgets,
      );
      const firstMissingPublication = missingPublicationWidgets[0]?.id;
      if (blockingIssues.length) {
        setPublishPanelOpen(false);
        if (firstMissingPublication) {
          setSelectedWidgetId(firstMissingPublication);
          setSelectedFilterId(null);
          setSettingsCollapsed(false);
          setWidgetSettingsMode('query');
        }
        publicationErrorRef.current = modal.error({
          title: '发布前校验未通过',
          width: 640,
          content: (
            <div className='max-h-[52vh] overflow-y-auto pr-1'>
              {missingPublicationWidgets.length > 0 && (
                <Alert
                  className='mb-3'
                  type='error'
                  showIcon
                  message={`${missingPublicationWidgets.length} 个组件缺少分享页筛选绑定`}
                  description={
                    <div>
                      <ul className='mb-3 list-disc pl-5'>
                        {missingPublicationWidgets.map(widget => (
                          <li key={widget.id}>{widget.title}</li>
                        ))}
                      </ul>
                      <Space wrap>
                        <Button
                          size='small'
                          onClick={() => {
                            const first = missingPublicationWidgets[0];
                            if (!first) return;
                            setSelectedWidgetId(first.id);
                            setSelectedFilterId(null);
                            setSettingsCollapsed(false);
                            setWidgetSettingsMode('query');
                            publicationErrorRef.current?.destroy();
                          }}
                        >
                          逐个修复
                        </Button>
                        <Button
                          size='small'
                          type='primary'
                          icon={<CommentOutlined />}
                          disabled={!assistantAvailable}
                          onClick={event => {
                            requestAgentPublicationRepair(
                              missingPublicationWidgets,
                              event.currentTarget.getBoundingClientRect(),
                            );
                            publicationErrorRef.current?.destroy();
                          }}
                        >
                          让数据助理统一修复
                        </Button>
                      </Space>
                    </div>
                  }
                />
              )}
              {otherIssues.map(issue => (
                <Alert
                  className='mb-2'
                  key={`${issue.path}-${issue.code}`}
                  type='error'
                  showIcon
                  message={validationIssueMessage(issue)}
                />
              ))}
            </div>
          ),
        });
        return;
      }

      const response = await publishDashboard(saved.id, saved.current_revision, filters, false);
      // Publishing a deferred remote version must not rebase local edits, and
      // a late publication response must not replace a newer revision.
      if (recordRef.current.current_revision === saved.current_revision) {
        setRecord({
          ...recordRef.current,
          status: 'published',
          asset_state: 'saved',
          saved_at: saved.saved_at || new Date().toISOString(),
        });
      }
      const snapshotUrl = `${window.location.origin}${response.data.data.share_path}`;
      if (mode === 'live') {
        try {
          const live = await createDashboardLiveShare(saved.id);
          if (!live.data.success || !live.data.data.share_path) throw new Error(live.data.err_msg || '链接生成失败');
          return {
            mode,
            snapshotUrl,
            url: `${live.data.data.public_base_url || window.location.origin}${live.data.data.share_path}`,
            expiresAt: live.data.data.expires_at,
          };
        } catch (error) {
          showRequestError(error, tr('固定快照已发布，但持续更新链接生成失败，请重试', 'The snapshot was published, but creating the live link failed. Please retry.'));
          return;
        }
      }
      return { mode, snapshotUrl, url: snapshotUrl };
    } catch (error) {
      showRequestError(error, tr('发布失败', 'Publication failed'));
    } finally {
      setPublishing(false);
    }
  };

  const addVisualizationWidget = (visualization: DashboardVisualization) => {
    focusManualEditor();
    const widget = makeUnconfiguredVisualizationWidget(visualization, schema.dashboard.data_source_id);
    widget.title = `新${visualizationNames[visualization]}`;
    widget.presentation = {
      visualization,
      orientation: visualization === 'bar' ? 'horizontal' : 'vertical',
      stacked: visualization === 'stacked_column',
      smooth: true,
      top_n: ['column', 'bar', 'stacked_column', 'pie', 'donut'].includes(visualization) ? 10 : null,
      colors: [...DASHBOARD_PALETTES.businessBlue.colors],
      unit: null,
      currency: null,
      precision: null,
      percentage: false,
      show_legend: true,
      show_grid: true,
      default_sort: { field: null, direction: 'default' },
    };
    setSchema(current => ({
      ...current,
      schema_version: current.schema_version === '1.4' ? '1.4' : '1.3',
      widgets: [...current.widgets, widget],
      layouts: { ...current.layouts, desktop: [...current.layouts.desktop, nextLayout(current, widget)] },
    }));
    setSelectedWidgetId(widget.id);
    setSelectedFilterId(null);
    setSettingsCollapsed(false);
    setWidgetSettingsMode('visual');
    message.info(`已添加${visualizationNames[visualization]}。铅笔用于可视化设置，SQL 图标用于配置查询。`);
  };

  const removeWidget = (widgetId: string) => {
    setSchema(current => ({
      ...current,
      widgets: current.widgets.filter(widget => widget.id !== widgetId),
      layouts: { ...current.layouts, desktop: current.layouts.desktop.filter(item => item.widget_id !== widgetId) },
    }));
    setSelectedWidgetId(null);
  };

  const addFilter = (type: DashboardFilterType) => {
    focusManualEditor();
    let filter = makeFilter(type);
    if (type === 'date_range' && dateFilterFieldCandidates.length) {
      const candidate = dateFilterFieldCandidates[0];
      filter = {
        ...filter,
        field: candidate.field,
        // A widget query may contain its own LIMIT without setting the result's
        // truncated flag. Snapshot-derived ranges are therefore suggestions,
        // never authoritative defaults.
        default: null,
      };
      const recommendation = recommendDashboardDateFilterParameters(
        filter.id,
        candidate.field,
        filterParameterCandidates,
      );
      if (recommendation) {
        setFilterParameterDrafts(current => ({
          ...current,
          [`${filter.id}:start`]: recommendation.startParameter,
          [`${filter.id}:end`]: recommendation.endParameter,
        }));
      }
    }
    setSchema(current => ({ ...current, filters: [...current.filters, filter] }));
    setFilters(current => ({ ...current, [filter.id]: filter.default }));
    setSelectedFilterId(filter.id);
    setSelectedWidgetId(null);
    setSettingsCollapsed(false);
    message.info(
      type === 'date_range' && dateFilterFieldCandidates.length
        ? '已识别日期字段；当前已加载范围仅供参考，确认后再采用并绑定组件。'
        : '筛选器已添加。请选择数据字段、默认值，并绑定使用对应 SQL 参数的组件。',
    );
  };

  const selectDateFilterField = (filterId: string, field: string) => {
    const candidate = dateFilterFieldCandidates.find(
      item => item.field.toLocaleLowerCase() === field.toLocaleLowerCase(),
    );
    if (!candidate) return;
    replaceFilter(filterId, current => ({ ...current, field: candidate.field, default: null, options: [] }));
    setFilters(current => ({ ...current, [filterId]: null }));
    const recommendation = recommendDashboardDateFilterParameters(filterId, candidate.field, filterParameterCandidates);
    if (recommendation) {
      setFilterParameterDrafts(current => ({
        ...current,
        [`${filterId}:start`]: recommendation.startParameter,
        [`${filterId}:end`]: recommendation.endParameter,
      }));
    }
    message.info(`已选择日期字段 ${candidate.field}；请确认默认范围后再绑定组件。`);
  };

  const populateDateFilterFromCurrentData = (filterId: string, field?: string) => {
    const filter = schema.filters.find(item => item.id === filterId);
    if (!filter || filter.type !== 'date_range') return;
    const candidate =
      dateFilterFieldCandidates.find(
        item => item.field.toLocaleLowerCase() === (field || filter.field).toLocaleLowerCase(),
      ) || dateFilterFieldCandidates[0];
    if (!candidate) {
      message.warning(tr('当前看板结果中没有识别出日期字段。可手工填写字段、默认范围和 SQL 参数。', 'No date field was found in the current results. Enter the field, default range and SQL parameters manually.'));
      return;
    }
    const defaultValue = candidate.dateRange || null;
    replaceFilter(filterId, current => ({
      ...current,
      field: candidate.field,
      default: defaultValue,
      options: [],
    }));
    setFilters(current => ({ ...current, [filterId]: defaultValue }));
    const recommendation = recommendDashboardDateFilterParameters(filterId, candidate.field, filterParameterCandidates);
    if (recommendation) {
      setFilterParameterDrafts(current => ({
        ...current,
        [`${filterId}:start`]: recommendation.startParameter,
        [`${filterId}:end`]: recommendation.endParameter,
      }));
    }
    message.success(
      candidate.dateRange
        ? candidate.rangeIsPartial
          ? `已采用当前已加载范围 ${candidate.dateRange[0]} 至 ${candidate.dateRange[1]}；结果已截断，请核对是否完整`
          : `已识别日期范围 ${candidate.dateRange[0]} 至 ${candidate.dateRange[1]}`
        : `已选择日期字段 ${candidate.field}`,
    );
  };

  const populateFilterFromCurrentData = (filterId: string, field?: string) => {
    const filter = schema.filters.find(item => item.id === filterId);
    if (!filter || !['select', 'multi_select'].includes(filter.type)) return;
    const candidate = filterFieldCandidates.find(
      item => item.field.toLocaleLowerCase() === (field || filter.field).toLocaleLowerCase(),
    );
    if (!candidate || candidate.options.length === 0) {
      message.warning(tr('当前看板数据中没有找到这个字段的可选值；你仍可在下方手动输入选项。', 'No options were found for this field; you can enter them manually below.'));
      return;
    }
    const defaultValue = filter.type === 'multi_select' ? [] : null;
    replaceFilter(filterId, current => ({
      ...current,
      field: candidate.field,
      options: candidate.options,
      default: defaultValue,
    }));
    setFilters(current => ({ ...current, [filterId]: defaultValue }));
    setFilterParameterDrafts(current => ({
      ...current,
      [filterId]:
        recommendDashboardFilterParameter(filterId, candidate.field, filterParameterCandidates) ||
        normalizeDashboardFilterParameter(candidate.field, normalizeDashboardFilterParameter(filterId)),
    }));
    message.success(`已从当前结果导入 ${candidate.options.length} 个可选值`);
  };

  const bindFilterToCompatibleWidgets = (filter: DashboardFilter, requestedParameter: string) => {
    const parameter = normalizeDashboardFilterParameter(
      requestedParameter,
      normalizeDashboardFilterParameter(filter.field, normalizeDashboardFilterParameter(filter.id)),
    );
    const matchingWidgetIds = schema.widgets
      .filter(widget => {
        if (sqlUsesNamedParameter(widget.query.sql || '', parameter)) return true;
        return Boolean(
          widget.query.federation?.sources.some(source => sqlUsesNamedParameter(source.sql || '', parameter)),
        );
      })
      .map(widget => widget.id);

    if (!matchingWidgetIds.length) {
      message.warning(`没有组件 SQL 使用 :${parameter}。请先在需要筛选的 SQL 中加入该命名参数。`);
      return;
    }

    setSchema(current => ({
      ...current,
      widgets: current.widgets.map(widget => {
        if (!matchingWidgetIds.includes(widget.id)) return widget;
        const mainMatches = sqlUsesNamedParameter(widget.query.sql || '', parameter);
        const federation = widget.query.federation
          ? {
              ...widget.query.federation,
              sources: widget.query.federation.sources.map(source =>
                sqlUsesNamedParameter(source.sql || '', parameter)
                  ? {
                      ...source,
                      filter_parameters: { ...source.filter_parameters, [filter.id]: parameter },
                    }
                  : source,
              ),
            }
          : widget.query.federation;
        return {
          ...widget,
          query: {
            ...widget.query,
            filter_parameters: mainMatches
              ? { ...widget.query.filter_parameters, [filter.id]: parameter }
              : widget.query.filter_parameters,
            federation,
          },
        };
      }),
    }));
    setFilterParameterDrafts(current => ({ ...current, [filter.id]: parameter }));
    message.success(`已绑定到 ${matchingWidgetIds.length} 个使用 :${parameter} 的组件`);
  };

  const bindDateFilterToCompatibleWidgets = (
    filter: DashboardFilter,
    requestedStartParameter: string,
    requestedEndParameter: string,
    rangeLabel = '日期范围',
  ) => {
    const startParameter = normalizeDashboardFilterParameter(requestedStartParameter, 'start_date');
    const endParameter = normalizeDashboardFilterParameter(requestedEndParameter, 'end_date');
    if (startParameter === endParameter) {
      message.warning(tr('开始参数和结束参数必须使用不同名称。', 'Start and end parameters must use different names.'));
      return;
    }
    const sourceUsesBoth = (sql: string) =>
      sqlUsesNamedParameter(sql || '', startParameter) && sqlUsesNamedParameter(sql || '', endParameter);
    const matchingWidgetIds = schema.widgets
      .filter(
        widget =>
          sourceUsesBoth(widget.query.sql || '') ||
          widget.query.federation?.sources.some(source => sourceUsesBoth(source.sql || '')),
      )
      .map(widget => widget.id);

    if (!matchingWidgetIds.length) {
      message.warning(
        `没有组件 SQL 同时使用 :${startParameter} 和 :${endParameter}。请先让数据助理生成${rangeLabel}条件，或在 SQL 设置中加入这两个参数。`,
      );
      return;
    }

    const binding: FilterParameterBinding = {
      start_parameter: startParameter,
      end_parameter: endParameter,
    };
    setSchema(current => ({
      ...current,
      widgets: current.widgets.map(widget => {
        if (!matchingWidgetIds.includes(widget.id)) return widget;
        const mainMatches = sourceUsesBoth(widget.query.sql || '');
        const federation = widget.query.federation
          ? {
              ...widget.query.federation,
              sources: widget.query.federation.sources.map(source =>
                sourceUsesBoth(source.sql || '')
                  ? {
                      ...source,
                      filter_parameters: { ...source.filter_parameters, [filter.id]: binding },
                    }
                  : source,
              ),
            }
          : widget.query.federation;
        return {
          ...widget,
          query: {
            ...widget.query,
            filter_parameters: mainMatches
              ? { ...widget.query.filter_parameters, [filter.id]: binding }
              : widget.query.filter_parameters,
            federation,
          },
        };
      }),
    }));
    setFilterParameterDrafts(current => ({
      ...current,
      [`${filter.id}:start`]: startParameter,
      [`${filter.id}:end`]: endParameter,
    }));
    message.success(`已将${rangeLabel}绑定到 ${matchingWidgetIds.length} 个组件`);
  };

  const removeFilter = (filterId: string) => {
    setSchema(current => ({
      ...current,
      filters: current.filters.filter(filter => filter.id !== filterId),
      widgets: current.widgets.map(widget => {
        const mappings = { ...widget.query.filter_parameters };
        delete mappings[filterId];
        const federation = widget.query.federation
          ? {
              ...widget.query.federation,
              sources: widget.query.federation.sources.map(source => {
                const sourceMappings = { ...source.filter_parameters };
                delete sourceMappings[filterId];
                return { ...source, filter_parameters: sourceMappings };
              }),
            }
          : widget.query.federation;
        return {
          ...widget,
          query: { ...widget.query, filter_parameters: mappings, federation },
        };
      }),
    }));
    setFilters(current => {
      const next = { ...current };
      delete next[filterId];
      return next;
    });
    if (selectedFilterId === filterId) setSelectedFilterId(null);
  };

  const updateEncoding = (name: keyof DashboardWidget['encoding'], value: string | string[] | undefined) => {
    if (!selectedWidget) return;
    replaceWidget(selectedWidget.id, widget => ({ ...widget, encoding: { ...widget.encoding, [name]: value } }));
  };

  const updateStyle = (name: string, value: unknown) => {
    if (!selectedWidget) return;
    replaceWidget(selectedWidget.id, widget => ({ ...widget, style: { ...widget.style, [name]: value } }));
  };

  const updateOutputFieldLabel = (fieldName: string, label: string) => {
    if (!selectedWidget) return;
    replaceWidget(selectedWidget.id, widget => ({
      ...widget,
      query: {
        ...widget.query,
        output_fields: widget.query.output_fields.map(field =>
          field.name === fieldName ? { ...field, label: label.trim() || null } : field,
        ),
      },
    }));
  };

  const setWidgetVisualization = (widgetId: string, visualization: DashboardVisualization) => {
    setSchema(current => ({
      ...current,
      schema_version: current.schema_version === '1.4' ? '1.4' : '1.3',
      widgets: current.widgets.map(widget => {
        if (widget.id !== widgetId) return widget;
        const fields = widget.query.output_fields.map(field => field.name);
        const first = fields[0];
        const second = fields[1] || first;
        const third = fields[2] || second;
        const type: DashboardWidgetType =
          visualization === 'kpi' || visualization === 'gauge'
            ? 'kpi'
            : visualization === 'table'
              ? 'table'
              : visualization === 'pie' || visualization === 'donut'
                ? 'pie'
                : visualization === 'line' || visualization === 'area'
                  ? 'line'
                  : 'bar';
        const encoding =
          visualization === 'kpi'
            ? { ...widget.encoding, value: widget.encoding.value || first, columns: [] }
            : visualization === 'gauge'
              ? {
                  ...widget.encoding,
                  value: widget.encoding.value || first,
                  target: widget.encoding.target || second,
                  columns: [],
                }
              : visualization === 'table'
                ? { ...widget.encoding, columns: widget.encoding.columns.length ? widget.encoding.columns : fields }
                : visualization === 'pie' || visualization === 'donut'
                  ? {
                      ...widget.encoding,
                      category: widget.encoding.category || first,
                      color: widget.encoding.color || first,
                      angle: widget.encoding.angle || second,
                      columns: [],
                    }
                  : visualization === 'cohort'
                    ? {
                        ...widget.encoding,
                        row: fields.includes('cohort') ? 'cohort' : first,
                        column: fields.includes('age') ? 'age' : second,
                        value: fields.includes('retained') ? 'retained' : third,
                        target: fields.includes('cohort_size') ? 'cohort_size' : fields[3] || third,
                        color: fields.includes('observed') ? 'observed' : fields[4] || third,
                        columns: [],
                      }
                    : visualization === 'heatmap'
                      ? {
                          ...widget.encoding,
                          row: widget.encoding.row || first,
                          column: widget.encoding.column || second,
                          value: widget.encoding.value || third,
                          columns: [],
                        }
                      : visualization === 'dual_axis'
                        ? {
                            ...widget.encoding,
                            x: widget.encoding.x || first,
                            y: widget.encoding.y || second,
                            y2: widget.encoding.y2 || third,
                            columns: [],
                          }
                        : {
                            ...widget.encoding,
                            x: widget.encoding.x || first,
                            y: widget.encoding.y || second,
                            columns: [],
                          };
        return {
          ...widget,
          type,
          encoding,
          presentation: {
            visualization,
            orientation: visualization === 'bar' ? 'horizontal' : 'vertical',
            stacked: visualization === 'stacked_column',
            smooth: widget.presentation?.smooth ?? true,
            top_n: widget.presentation?.top_n ?? null,
            colors: widget.presentation?.colors || [],
            unit: widget.presentation?.unit ?? null,
            currency: widget.presentation?.currency ?? null,
            precision: widget.presentation?.precision ?? null,
            percentage: widget.presentation?.percentage ?? false,
            show_legend: widget.presentation?.show_legend ?? null,
            show_grid: widget.presentation?.show_grid ?? null,
            default_sort: widget.presentation?.default_sort || { field: null, direction: 'default' },
          },
        };
      }),
    }));
  };

  const updatePresentation = (name: string, value: unknown) => {
    if (!selectedWidget) return;
    setSchema(current => ({
      ...current,
      schema_version: current.schema_version === '1.4' ? '1.4' : '1.3',
      widgets: current.widgets.map(widget =>
        widget.id === selectedWidget.id
          ? {
              ...widget,
              presentation: {
                visualization: widgetVisualization(widget),
                orientation: null,
                stacked: false,
                smooth: true,
                top_n: null,
                colors: [],
                unit: null,
                currency: null,
                precision: null,
                percentage: false,
                show_legend: null,
                show_grid: null,
                default_sort: { field: null, direction: 'default' },
                ...widget.presentation,
                [name]: value,
              },
            }
          : widget,
      ),
    }));
  };

  const setWidgetPalette = (palette: DashboardPaletteId) => {
    updatePresentation('colors', [...DASHBOARD_PALETTES[palette].colors]);
  };

  const changeFilterType = (filterId: string, type: DashboardFilterType) => {
    const defaultValue = type === 'multi_select' ? [] : type === 'number_range' ? [null, null] : null;
    replaceFilter(filterId, filter => ({
      ...filter,
      type,
      default: defaultValue,
      options: ['select', 'multi_select'].includes(type) ? filter.options : [],
    }));
    setFilters(current => ({ ...current, [filterId]: defaultValue }));
  };

  const setFilterBinding = (filter: DashboardFilter, value: string | FilterParameterBinding) => {
    if (!selectedWidget) return;
    replaceWidget(selectedWidget.id, widget => ({
      ...widget,
      query: {
        ...widget.query,
        filter_parameters: { ...widget.query.filter_parameters, [filter.id]: value },
      },
    }));
  };

  const updatePublicationBinding = (update: (binding: DashboardPublicationBinding) => DashboardPublicationBinding) => {
    if (!selectedWidget?.publication) return;
    setSchema(current => ({
      ...current,
      schema_version: current.schema_version === '1.4' ? '1.4' : '1.3',
      widgets: current.widgets.map(widget =>
        widget.id === selectedWidget.id && widget.publication
          ? { ...widget, publication: update(widget.publication) }
          : widget,
      ),
    }));
  };

  const initializePublicationBinding = () => {
    if (!selectedWidget) return;
    setSchema(current => ({
      ...current,
      schema_version: current.schema_version === '1.4' ? '1.4' : '1.3',
      widgets: current.widgets.map(widget => {
        if (widget.id !== selectedWidget.id) return widget;
        return {
          ...widget,
          publication: {
            query: {
              ...widget.query,
              filter_parameters: {},
              default_parameters: {},
              max_rows: Math.max(1000, Math.min(5000, widget.query.max_rows || 1000)),
            },
            filter_fields: {},
            group_by: [],
            measures: [],
            output_columns: widget.query.output_fields.map(field => field.name),
            row_mode: widget.type === 'table',
            sort: [],
            max_output_rows: Math.max(1, Math.min(1000, widget.query.max_rows || 1000)),
          },
        };
      }),
    }));
  };

  const removePublicationBinding = () => {
    if (!selectedWidget) return;
    setSchema(current => ({
      ...current,
      widgets: current.widgets.map(widget =>
        widget.id === selectedWidget.id ? { ...widget, publication: undefined } : widget,
      ),
    }));
  };

  const updatePublicationOutputFields = (rawNames: string[]) => {
    const names = Array.from(new Set(rawNames.map(name => name.trim()).filter(Boolean)));
    updatePublicationBinding(binding => {
      const existing = new Map(binding.query.output_fields.map(field => [field.name, field]));
      return {
        ...binding,
        query: {
          ...binding.query,
          output_fields: names.map(name => existing.get(name) || { name, type: 'unknown', nullable: true }),
        },
      };
    });
  };

  const handleAnnotationTarget = (target: DashboardSelectionTarget, anchor: DOMRect) => {
    setSettingsCollapsed(true);
    setAnnotationSelection({ target, anchor });
    if (target.kind === 'filter' && target.filter_id) {
      setSelectedFilterId(target.filter_id);
      setSelectedWidgetId(null);
    } else {
      setSelectedWidgetId(target.widget_id || null);
      setSelectedFilterId(null);
    }
  };

  const editAnnotationDraft = (draft: DashboardAnnotationDraft, anchor?: DOMRect) => {
    const node = Array.from(document.querySelectorAll<HTMLElement>('[data-dashboard-widget-id]')).find(
      item => item.dataset.dashboardWidgetId === draft.target.widget_id,
    );
    node?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    setAnnotationSelection({
      target: draft.target,
      anchor: anchor || node?.getBoundingClientRect() || new DOMRect(window.innerWidth / 2, 100, 1, 1),
      suggestedPrompt: draft.content,
      draftId: draft.id,
    });
  };

  const locateAnnotationTarget = (draft: DashboardAnnotationDraft) => {
    const node = Array.from(
      document.querySelectorAll<HTMLElement>('[data-dashboard-widget-id], [data-dashboard-filter-id]'),
    ).find(
      item =>
        (draft.target.widget_id && item.dataset.dashboardWidgetId === draft.target.widget_id) ||
        (draft.target.filter_id && item.dataset.dashboardFilterId === draft.target.filter_id),
    );
    node?.scrollIntoView({
      block: 'center',
      behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth',
    });
    setSelectedWidgetId(draft.target.widget_id || null);
    setSelectedFilterId(draft.target.filter_id || null);
    if (!node) message.info(tr('这个批注对应的组件已被移除，记录仍保留。', 'The annotated widget has been removed; the record was retained.'));
  };

  const removeAnnotationDraft = (id: string) => {
    assistantRetryRef.current = null;
    setAssistantSession(current => {
      const retired = new Set(current.saved.find(item => item.id === id)?.annotationIds || []);
      return {
        ...current,
        lastRequest: undefined,
        annotationIds: current.annotationIds.filter(value => !retired.has(value)),
        drafts: current.drafts.filter(item => item.id !== id),
        pending: current.pending.filter(item => item.id !== id),
        saved: current.saved.filter(item => item.id !== id),
        messages: current.messages.map(item => (item.failed ? { ...item, failed: false } : item)),
      };
    });
  };

  const handleResolveNaturalTarget = async (reference: string): Promise<DashboardTargetResolution> => {
    const response = await resolveDashboardTarget(record.id, reference, selectedWidgetId);
    const resolution = response.data.data;
    if (resolution.status === 'resolved' && resolution.target?.widget_id) {
      setSelectedWidgetId(resolution.target.widget_id);
      setSelectedFilterId(null);
    }
    return resolution;
  };

  const requestAgentWidgetConfiguration = (widget: DashboardWidget, anchor: DOMRect) => {
    setAnnotationMode(true);
    setSelectedWidgetId(widget.id);
    setSelectedFilterId(null);
    setAnnotationSelection({
      target: {
        kind: 'widget',
        widget_id: widget.id,
        label: `组件：${widget.title}`,
        datum_key: {},
        row_key: {},
      },
      anchor,
      suggestedPrompt: `请根据当前看板的数据源、业务主题和全局筛选器，为“${widget.title}”生成合适的只读查询、输出字段和${visualizationNames[widgetVisualization(widget)]}字段映射。先给出可验证的修改方案，不要直接应用。`,
    });
  };

  const requestAgentPublicationRepair = (widgets: Pick<DashboardWidget, 'id' | 'title'>[], anchor: DOMRect) => {
    const first = widgets[0];
    if (!first) return;
    const titles = widgets.map(widget => `“${widget.title}”`).join('、');
    setAnnotationMode(true);
    setSelectedWidgetId(first.id);
    setSelectedFilterId(null);
    setSettingsCollapsed(false);
    setWidgetSettingsMode('query');
    setAnnotationSelection({
      target: {
        kind: 'widget',
        widget_id: first.id,
        label: `发布契约统一修复：${titles}`,
        datum_key: {},
        row_key: {},
      },
      anchor,
      suggestedPrompt: `请统一修复 ${titles} 的分享页筛选数据绑定。每个组件都必须补齐发布用只读查询、发布字段、全局筛选器到发布字段的映射、明细模式或分组与指标聚合、排序规则及最大输出行数；先执行与发布按钮相同的完整校验，再给出可验证的修改方案，不要直接应用。`,
    });
  };

  const requestAgentFilterConfiguration = (filter: DashboardFilter, anchor: DOMRect) => {
    setAnnotationMode(true);
    setSelectedWidgetId(null);
    setSelectedFilterId(filter.id);
    setAnnotationSelection({
      target: {
        kind: 'filter',
        filter_id: filter.id,
        label: `全局筛选器：${filter.label}`,
        datum_key: {},
        row_key: {},
      },
      anchor,
      suggestedPrompt: `请根据当前看板的数据源、业务主题和组件查询，为全局筛选器“${filter.label}”配置合适的类型、数据字段、默认值、可选值、影响组件范围及 SQL 参数绑定。先给出可验证的最小修改方案，不要直接应用。`,
    });
  };

  const handleCreateAnnotation = async (prompt: string) => {
    if (!annotationSelection || assistantRunning) return;
    const attachedIds = new Set([...annotationDrafts, ...assistantSession.pending].map(item => item.id));
    if (!annotationSelection.draftId && attachedIds.size >= 20) {
      message.info(tr('本批已保存 20 条批注，请先一起发送，再继续添加。', 'This batch has 20 annotations. Send them before adding more.'));
      return;
    }
    const draft = {
      ...makeDashboardAnnotationDraft(annotationSelection.target),
      id: annotationSelection.draftId || makeDashboardAnnotationDraft(annotationSelection.target).id,
      content: prompt,
    };
    const widget = schema.widgets.find(item => item.id === draft.target.widget_id);
    const saved = {
      ...draft,
      chartType: widget ? visualizationNames[widgetVisualization(widget)] : '全局筛选',
      dashboardTitle: schema.dashboard.title,
      savedAt: new Date().toISOString(),
      state: 'saved' as const,
    };
    assistantRetryRef.current = null;
    setAssistantSession(current => ({
      ...current,
      lastRequest: undefined,
      annotationIds: current.annotationIds.filter(
        id => !current.saved.find(item => item.id === draft.id)?.annotationIds?.includes(id),
      ),
      messages: current.messages.map(item => (item.failed ? { ...item, failed: false } : item)),
      drafts: current.drafts.some(item => item.id === draft.id)
        ? current.drafts.map(item => (item.id === draft.id ? draft : item))
        : [...current.drafts, draft],
      saved: current.saved.some(item => item.id === draft.id)
        ? current.saved.map(item => (item.id === draft.id ? saved : item))
        : [...current.saved, saved],
    }));
    setAnnotationSelection(null);
    setLibraryMode('assistant');
    setLibraryCollapsed(false);
    message.success({
      key: 'dashboard-annotation-draft',
      content: '批注已加入左侧输入框，可继续添加后一起发送',
      duration: 2,
    });
  };

  const handleSubmitAnnotationDrafts = async (
    drafts: DashboardAnnotationDraft[],
    onStatus: (status: string) => void,
    latestMessage: string,
    conversation: string,
  ) => {
    if (!assistantAvailable) throw new Error(tr('此看板没有可续接的数据助理任务', 'No data assistant task is available for this dashboard.'));
    onStatus(tr('正在结合看板和最近对话思考…', 'Reviewing the dashboard and recent conversation…'));
    const selectedModel = localStorage.getItem(SELECTED_MODEL_STORAGE_KEY) || undefined;
    const context = {
      message: latestMessage,
      conversation,
      view_context: buildDashboardAssistantContext(schema, filters, snapshot),
    };
    const batchKey = JSON.stringify([record.id, drafts, selectedModel, context]);
    let resolution = intentResolutionRef.current?.key === batchKey ? intentResolutionRef.current.resolution : null;
    if (!resolution) {
      try {
        const response = await resolveDashboardAnnotationIntents(
          record.id,
          drafts.map(draft => ({ draft_id: draft.id, prompt: draft.content.trim(), target: draft.target })),
          selectedModel,
          context,
          assistantAbortRef.current?.signal,
        );
        if (!response.data.success || !response.data.data)
          throw new Error(response.data.err_msg || '意图识别失败，请重试');
        resolution = response.data.data;
      } catch (error) {
        throw new Error(describeDashboardError(error, tr('意图识别暂时不可用，批注已保留，请重试。', 'Intent recognition is unavailable. Annotations were retained; please retry.')));
      }
    }
    const resolvedDrafts = resolveDashboardAnnotationDrafts(drafts, resolution);
    const questions = resolution.items.filter(item => item.question);
    const pendingIds = questions.map(item => item.draft_id);
    const introduction = resolution.reply?.trim() || questions.map(item => item.question).join('\n\n');
    if (!resolvedDrafts.length)
      return {
        reply: introduction,
        pendingIds,
        persisted: [],
      };
    if (!validateInBrowser()) throw new Error(tr('看板校验未通过，请先修复当前草稿', 'Dashboard validation failed. Correct the draft first.'));
    assistantAbortRef.current?.signal.throwIfAborted();
    intentResolutionRef.current = { key: batchKey, resolution };
    onStatus(tr('意图已识别，正在保存批注…', 'Intent identified; saving annotations…'));
    const annotationRecord = isDirty ? await persistDraft(false) : record;
    const persisted = await Promise.all(
      resolvedDrafts.map(async draft => {
        const key = JSON.stringify([annotationRecord.id, annotationRecord.current_revision, draft]);
        const saved =
          persistedAnnotationsRef.current.get(key) ||
          annotations.find(
            item =>
              assistantSession.annotationIds.includes(item.id) &&
              item.base_revision === annotationRecord.current_revision &&
              item.prompt === draft.content.trim() &&
              item.intent === draft.intent &&
              JSON.stringify(item.target) === JSON.stringify(draft.target) &&
              ['pending', 'proposed'].includes(item.status),
          );
        if (saved) return { annotation: saved, intent: saved.intent };
        const response = await createDashboardAnnotation(annotationRecord.id, {
          base_revision: annotationRecord.current_revision,
          target: draft.target,
          prompt: draft.content.trim(),
          intent: draft.intent,
          conversation_id: annotationRecord.conversation_id || undefined,
          source_turn_id: annotationRecord.source_turn_id || undefined,
        });
        if (!response.data.success || !response.data.data)
          throw new Error(response.data.err_msg || '保存批注失败，请重试');
        persistedAnnotationsRef.current.set(key, response.data.data);
        return { annotation: response.data.data, intent: response.data.data.intent };
      }),
    );
    setAnnotations(current => [
      ...persisted.map(item => item.annotation),
      ...current.filter(item => !persisted.some(saved => saved.annotation.id === item.id)),
    ]);
    setAssistantSession(current => {
      const retired = new Set(
        current.saved
          .filter(item => drafts.some(draft => draft.id === item.id))
          .flatMap(item => item.annotationIds || []),
      );
      return {
        ...current,
        annotationIds: [
          ...new Set([
            ...current.annotationIds.filter(id => !retired.has(id)),
            ...persisted.map(item => item.annotation.id),
          ]),
        ],
        saved: current.saved.map(item => {
          const ids = resolvedDrafts.flatMap((draft, index) =>
            draft.id.startsWith(item.id + ':') ? [persisted[index].annotation.id] : [],
          );
          return ids.length ? { ...item, annotationIds: ids } : item;
        }),
      };
    });
    const replies: string[] = [];
    const modifications = persisted.filter(item => item.intent === 'modify');
    for (const [index, item] of modifications.entries()) {
      onStatus(`正在配置并验证「${item.annotation.target.label}」 (${index + 1}/${modifications.length})…`);
      const resolved = resolvedDrafts[persisted.indexOf(item)];
      const original = drafts.find(draft => resolved?.id === draft.id + ':modify');
      const response = await generateDashboardAnnotationProposal(
        annotationRecord.id,
        item.annotation.id,
        selectedModel,
        assistantAbortRef.current!.signal,
        JSON.stringify({
          annotation: original?.content || item.annotation.prompt,
          message: latestMessage,
        }),
      );
      const proposed = response.data.data;
      if (!response.data.success || proposed?.status !== 'proposed' || !proposed.proposal) {
        throw new Error(response.data.err_msg || '修改方案未完成，批注已保留，请重试');
      }
      setAnnotations(current => current.map(value => (value.id === proposed.id ? proposed : value)));
      replies.push(proposed.proposal.summary);
    }
    const explanatory = persisted.filter(item => item.intent !== 'modify');
    if (explanatory.length) {
      onStatus(tr('正在整理解释结果…', 'Preparing the explanation…'));
      replies.push(
        await runDashboardAssistant(
          annotationRecord,
          buildDashboardAssistantPrompt(annotationRecord, explanatory, snapshot?.widgets),
          onStatus,
          assistantAbortRef.current!.signal,
          handleQuestionEvent,
        ),
      );
      const resolved = await Promise.all(
        explanatory.map(item => rejectDashboardAnnotation(annotationRecord.id, item.annotation.id)),
      );
      setAnnotations(current =>
        current.map(item => resolved.find(response => response.data.data.id === item.id)?.data.data || item),
      );
    }
    // Once tools finish, report their result rather than repeat an unverified plan.
    const discussion = questions.length || resolution.items.some(item => item.answered) ? introduction : '';
    if (modifications.length) replies.push(tr('修改方案已通过验证，请审阅后应用。', 'The proposal passed validation. Review it before applying.'));
    return { reply: [discussion, ...replies].filter(Boolean).join('\n\n'), pendingIds, persisted };
  };

  const sendAssistantMessage = async (text: string, submitted: DashboardAnnotationDraft[] = [], retry = false) => {
    if (assistantAbortRef.current) return;
    const context = retry
      ? (assistantRetryRef.current?.context ?? assistantSession.lastRequest?.context ?? '')
      : assistantSession.messages
          .filter(item => !item.failed)
          .slice(-10)
          .map(
            item =>
              `${item.role}: ${item.content}${item.annotations?.length ? '\n附带批注：' + JSON.stringify(item.annotations.map(annotation => ({ target: annotation.target, content: annotation.content }))) : ''}`,
          )
          .join('\n')
          .slice(-16000);
    const controller = new AbortController();
    clearQuestions();
    assistantAbortRef.current = controller;
    assistantRetryRef.current = { text, drafts: submitted, context };
    setAssistantRunning(true);
    setLibraryMode('assistant');
    setLibraryCollapsed(false);
    setAnnotationTrayOpen(false);
    setSettingsCollapsed(true);
    setAnnotationSelection(null);
    const visible = text || (submitted.length ? '请按这批批注一起处理。' : '继续处理当前批注。');
    const relevantPending = assistantSession.pending.filter(
      item => item.target.kind !== 'dashboard' || !submitted.length,
    );
    const attached = [...new Map([...relevantPending, ...submitted].map(item => [item.id, item])).values()];
    const messageAnnotations = attached.flatMap(draft => {
      const saved = assistantSession.saved.find(item => item.id === draft.id);
      return saved ? [{ ...saved, ...draft }] : [];
    });
    const messageId = `assistant-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    if (!retry)
      setAssistantSession(current => ({
        ...current,
        messages: [
          ...current.messages,
          { id: messageId + '-user', role: 'user', content: visible, annotations: messageAnnotations },
        ],
      }));
    const pending = attached;
    const clarification = retry
      ? assistantSession.clarification
      : [...assistantSession.clarification, ...(text ? [text] : [])];
    setAssistantSession(current => ({ ...current, lastRequest: { text, drafts: submitted, context } }));
    const drafts = pending.length
      ? pending.map(draft => ({
          ...draft,
          content: draft.content,
        }))
      : [
          {
            ...makeDashboardAnnotationDraft({
              kind: 'dashboard',
              label: `看板：${record.schema.dashboard.title}`,
              datum_key: {},
              row_key: {},
            }),
            content: text,
          },
        ];
    try {
      if (!pending.length && text) {
        const target = await handleResolveNaturalTarget(text);
        if (target.status === 'resolved' && target.target) drafts[0].target = target.target;
      }
      const result = await handleSubmitAnnotationDrafts(drafts, setAssistantStatus, visible, context);
      if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
      const ids = new Set(pending.map(item => item.id));
      setAssistantSession(current => ({
        ...current,
        messages: [...current.messages, { id: messageId, role: 'assistant', content: result.reply }],
        drafts: current.drafts.filter(item => !ids.has(item.id)),
        pending: (pending.length ? pending : drafts).filter(item => result.pendingIds.includes(item.id)),
        clarification: result.pendingIds.length ? clarification : [],
        saved: current.saved.map(item =>
          ids.has(item.id)
            ? {
                ...item,
                state: result.pendingIds.includes(item.id) ? 'discussing' : 'sent',
              }
            : item,
        ),
      }));
      const latest = await listDashboardAnnotations(record.id);
      if (latest.data.success) setAnnotations(latest.data.data);
    } catch (error) {
      const stopped = controller.signal.aborted;
      setAssistantSession(current => ({
        ...current,
        pending: pending.length ? pending : drafts,
        clarification,
        messages: [
          ...current.messages,
          {
            id: messageId,
            role: 'assistant',
            content: stopped
              ? '已停止本次回复。批注仍保留，可以继续补充或重试。'
              : describeDashboardError(error, '这次请求没有完成，批注已保留，可以重试。'),
            failed: true,
          },
        ],
      }));
    } finally {
      assistantAbortRef.current = null;
      clearQuestions();
      setAssistantRunning(false);
      setAssistantStatus('');
    }
  };

  const acceptAnnotationRecord = (next: DashboardRecord, submitted: DashboardSchemaV1) => {
    if (next.current_revision < recordRef.current.current_revision) return false;
    const current = JSON.stringify(schemaRef.current);
    if (current !== JSON.stringify(submitted) && current !== JSON.stringify(next.schema)) {
      collaboration.deferRemoteRecord(next);
      message.warning(tr('方案已在服务器应用；请求期间的本地修改已保留，请确认后再加载远端版本', 'The proposal was applied on the server. Local changes were retained; review them before loading the remote version.'));
      return false;
    }
    setRecord(next);
    resetSchema(next.schema);
    clearDashboardLocalDraft(next.id);
    return true;
  };

  const applyAssistantBatch = async () => {
    if (isDirty) {
      message.info(tr('请先保存当前手动修改，再应用 AI 方案', 'Save manual changes before applying the AI proposal.'));
      return;
    }
    const proposals = assistantProposals;
    if (!proposals.length || applyingAnnotationId) return;
    setApplyingAnnotationId('batch');
    try {
      const response = await applyDashboardAnnotationBatch(
        record.id,
        proposals.map(item => item.id),
        record.current_revision,
      );
      if (!response.data.success) throw new Error(response.data.err_msg || '批量应用失败');
      const next = response.data.data.operation.dashboard;
      setAnnotations(current =>
        current.map(item => response.data.data.annotations.find(updated => updated.id === item.id) || item),
      );
      if (!acceptAnnotationRecord(next, schema)) return;
      setAssistantSession(current => ({
        ...current,
        messages: [
          ...current.messages,
          {
            id: `applied-${Date.now()}`,
            role: 'assistant',
            content: `已一起应用 ${proposals.length} 项修改。可以继续批注或讨论。`,
          },
        ],
      }));
      try {
        const refreshed = await refreshDashboard(next.id, filters);
        if (!refreshed.data.success) throw new Error('refresh failed');
        setSnapshot(refreshed.data.data);
      } catch {
        message.warning(tr('本批修改已应用，但数据刷新失败；请稍后刷新数据', 'Changes were applied, but data refresh failed. Refresh later.'));
      }
    } catch (error) {
      showRequestError(error, tr('未能应用本批修改', 'Could not apply these changes'));
    } finally {
      setApplyingAnnotationId(null);
    }
  };

  const handleApplyAnnotation = async (annotation: DashboardAnnotationRecord) => {
    if (isDirty) {
      message.info(tr('请先保存当前手动修改，再应用 AI 方案', 'Save manual changes before applying the AI proposal.'));
      return;
    }
    if (applyingAnnotationId) return;
    setApplyingAnnotationId(annotation.id);
    try {
      const response = await applyDashboardAnnotation(record.id, annotation.id, {
        expected_revision: record.current_revision,
        operation_id: `annotation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`,
        client_id: `dashboard-editor-${record.id}`,
      });
      const payload = response.data.data;
      const nextRecord = payload.operation.dashboard;
      setAnnotations(current => current.map(item => (item.id === annotation.id ? payload.annotation : item)));
      if (!acceptAnnotationRecord(nextRecord, schema)) return;
      try {
        const refreshed = await refreshDashboard(nextRecord.id, filters);
        setSnapshot(refreshed.data.data);
      } catch {
        message.warning(tr('修改已经应用，但数据刷新失败；请稍后点击“刷新”重试', 'The changes were applied, but refresh failed. Select Refresh to retry.'));
      }
      message.success(tr('Agent 修改已应用到真实草稿', 'Agent changes were applied to the draft'));
    } catch (error) {
      showRequestError(error, tr('应用批注方案失败', 'Could not apply the annotation proposal'));
    } finally {
      setApplyingAnnotationId(null);
    }
  };

  const handleRejectAnnotation = async (annotation: DashboardAnnotationRecord) => {
    setApplyingAnnotationId(annotation.id);
    try {
      const response = await rejectDashboardAnnotation(record.id, annotation.id);
      setAnnotations(current => current.map(item => (item.id === annotation.id ? response.data.data : item)));
      message.success(tr('已放弃这次修改方案，看板没有变化', 'The proposal was discarded; the dashboard is unchanged.'));
    } catch (error) {
      showRequestError(error, tr('放弃批注方案失败', 'Could not discard the annotation proposal'));
    } finally {
      setApplyingAnnotationId(null);
    }
  };

  const editorTheme = resolveDashboardTheme(schema.dashboard.theme);
  return (
    <ConfigProvider
      theme={{
        algorithm: editorTheme.mode === 'dark' ? antdTheme.darkAlgorithm : antdTheme.defaultAlgorithm,
        inherit: false,
        token: dashboardAntdTokens(editorTheme),
      }}
    >
      <div
        data-testid={`dashboard-editor-${mode}`}
        className={styles.editorRoot}
        style={{
          ...interfaceThemeVariables(resolveDashboardTheme(schema.dashboard.theme)),
          ...dashboardThemeCssVariables(resolveDashboardTheme(schema.dashboard.theme)),
        }}
      >
        <header className={styles.topbar}>
          <div className={styles.brandGroup}>
            <div className={styles.brandMark} aria-hidden='true'>
              {schema.dashboard.title.trim().slice(0, 1).toUpperCase() || 'D'}
            </div>
            <div className={styles.titleBlock}>
              <div className={styles.titleRow}>
                <Input
                  aria-label={tr('看板标题', 'Dashboard title')}
                  variant='borderless'
                  className={styles.titleInput}
                  value={schema.dashboard.title}
                  onChange={event =>
                    setSchema(current => ({
                      ...current,
                      dashboard: { ...current.dashboard, title: event.target.value },
                    }))
                  }
                />
                <Tag
                  className={styles.statusTag}
                  style={statusTagStyle(isDirty ? 'accent' : record.status === 'published' ? 'success' : 'warning')}
                >
                  {isDirty
                    ? tr('未保存', 'Unsaved')
                    : record.asset_state === 'generated'
                      ? tr('生成草稿', 'Generated draft')
                      : record.status === 'published'
                        ? tr('已发布', 'Published')
                        : tr('已保存资产', 'Saved asset')}
                </Tag>
              </div>
              <div className={styles.metaRow}>
                <span>{tr(`修订 ${record.current_revision}`, `Revision ${record.current_revision}`)}</span>
                <span className={styles.metaDot} />
                <span>{tr(`${schema.widgets.length} 个组件`, `${schema.widgets.length} widgets`)}</span>
                <span className={styles.metaDot} />
                <Tooltip
                  title={
                    collaboration.status === 'online'
                      ? tr(`${collaboration.participants.length || 1} 个协作客户端在线；保存后会立即同步。`, `${collaboration.participants.length || 1} collaborators online; changes sync on save.`)
                      : collaboration.status === 'conflict'
                        ? tr('另一位协作者已保存新版本，请先处理冲突。', 'Another collaborator saved a new version. Resolve the conflict first.')
                        : collaboration.status === 'connecting'
                          ? tr('正在建立协作连接', 'Connecting to collaboration')
                          : tr('协作连接暂时离线，系统会自动重连', 'Collaboration is offline; reconnecting automatically')
                  }
                >
                  <Tag
                    className={styles.collaborationBadge}
                    style={statusTagStyle(
                      collaboration.status === 'online'
                        ? 'success'
                        : collaboration.status === 'conflict'
                          ? 'danger'
                          : collaboration.status === 'connecting'
                            ? 'accent'
                            : 'muted',
                    )}
                  >
                    {collaboration.status === 'online'
                      ? tr(`协作在线 ${collaboration.participants.length || 1}`, `Online ${collaboration.participants.length || 1}`)
                      : collaboration.status === 'conflict'
                        ? tr('协作冲突', 'Collaboration conflict')
                        : collaboration.status === 'connecting'
                          ? tr('连接协作', 'Connecting')
                          : tr('协作离线', 'Collaboration offline')}
                  </Tag>
                </Tooltip>
              </div>
            </div>
          </div>

          <div className={styles.toolbarActions}>
            {mode === 'standalone' && standaloneFocused && (
              <Button aria-label={tr('显示导航', 'Show navigation')} onClick={restoreBrowsingLayout} icon={<MenuUnfoldOutlined />}>
                {tr('显示导航', 'Show navigation')}
              </Button>
            )}
            {mode === 'embedded' && (
              <>
                <Tooltip title={libraryCollapsed ? tr('展开组件库', 'Expand component library') : tr('收起组件库', 'Collapse component library')}>
                  <Button
                    aria-label={libraryCollapsed ? tr('展开组件库', 'Expand component library') : tr('收起组件库', 'Collapse component library')}
                    icon={<AppstoreOutlined />}
                    onClick={() => setLibraryCollapsed(value => !value)}
                  />
                </Tooltip>
                <Tooltip title={settingsCollapsed ? tr('展开属性设置', 'Expand properties') : tr('收起属性设置', 'Collapse properties')}>
                  <Button
                    aria-label={settingsCollapsed ? tr('展开属性设置', 'Expand properties') : tr('收起属性设置', 'Collapse properties')}
                    icon={<SettingOutlined />}
                    onClick={() => {
                      if (settingsCollapsed) focusManualEditor();
                      setSettingsCollapsed(value => !value);
                    }}
                  />
                </Tooltip>
                <Tooltip title={focused ? tr('恢复任务分栏', 'Restore task view') : tr('任务内放大编辑', 'Expand editor')}>
                  <Button
                    aria-label={focused ? tr('恢复任务分栏', 'Restore task view') : tr('任务内放大编辑', 'Expand editor')}
                    icon={focused ? <FullscreenExitOutlined /> : <FullscreenOutlined />}
                    onClick={() => (focused ? restoreBrowsingLayout() : onFocusChange?.(true))}
                  />
                </Tooltip>
              </>
            )}
            {LAYOUT_TEMPLATES_ENABLED && (
              <Button
                aria-label={tr('布局模板', 'Layout templates')}
                className={styles.layoutTemplateButton}
                icon={<AppstoreOutlined />}
                disabled={workspaceMode === 'preview'}
                onClick={() => setLayoutPickerOpen(true)}
              >
                {tr('布局模板', 'Layout templates')}
              </Button>
            )}
            <Tooltip title={tr('撤销 (Ctrl+Z)', 'Undo (Ctrl+Z)')}>
              <Button aria-label={tr('撤销', 'Undo')} type='text' icon={<UndoOutlined />} disabled={!canUndo} onClick={undo} />
            </Tooltip>
            <Tooltip title={tr('重做 (Ctrl+Shift+Z)', 'Redo (Ctrl+Shift+Z)')}>
              <Button aria-label={tr('重做', 'Redo')} type='text' icon={<RedoOutlined />} disabled={!canRedo} onClick={redo} />
            </Tooltip>
            <Button
              aria-label={tr('刷新看板数据', 'Refresh dashboard data')}
              type='text'
              icon={<ReloadOutlined />}
              loading={refreshing}
              onClick={handleRefresh}
            >
              {tr('刷新', 'Refresh')}
            </Button>
            <Segmented
              aria-label={tr('编辑预览切换', 'Switch between edit and preview')}
              value={workspaceMode}
              options={[
                { label: tr('编辑', 'Edit'), value: 'edit', icon: <EditOutlined /> },
                { label: tr('预览', 'Preview'), value: 'preview', icon: <EyeOutlined /> },
              ]}
              onChange={value => {
                const nextMode = value as WorkspaceMode;
                setWorkspaceMode(nextMode);
                if (nextMode === 'edit') focusManualEditor();
                else {
                  onFocusChange?.(false);
                  setStandaloneFocused(false);
                }
                if (nextMode === 'preview') {
                  setAnnotationMode(false);
                  setAnnotationSelection(null);
                }
              }}
            />
            <Button
              aria-label={tr('保存看板', 'Save dashboard')}
              icon={<SaveOutlined />}
              loading={saving}
              disabled={!isDirty && record.asset_state !== 'generated'}
              onClick={handleSave}
            >
              {tr('保存', 'Save')}
            </Button>
            <Dropdown
              trigger={['click']}
              menu={{
                items: [
                  { key: 'schedule', label: tr('定时任务', 'Scheduled tasks'), icon: <CalendarOutlined /> },
                  { key: 'files', label: tr('工程文件', 'Project files'), icon: <FolderOpenOutlined /> },
                  { key: 'access', label: tr('权限与审计', 'Access and audit'), icon: <SafetyCertificateOutlined /> },
                  { key: 'lifecycle', label: tr('版本与分享', 'Versions and sharing'), icon: <HistoryOutlined /> },
                ],
                onClick: ({ key }) => {
                  if (key === 'schedule') setSchedulePanelOpen(true);
                  if (key === 'files') setArtifactPanelOpen(true);
                  if (key === 'access') setAccessPanelOpen(true);
                  if (key === 'lifecycle') setLifecyclePanelOpen(true);
                },
              }}
            >
              <Button aria-label={tr('更多看板操作', 'More dashboard actions')} icon={<MoreOutlined />}>
                {tr('更多', 'More')}
              </Button>
            </Dropdown>
            <Button
              aria-label={tr('发布看板', 'Publish dashboard')}
              type='primary'
              icon={<ShareAltOutlined />}
              loading={publishing}
              onClick={() => setPublishPanelOpen(true)}
            >
              {tr('发布', 'Publish')}
            </Button>
          </div>
        </header>

        <section className={styles.filterBar} aria-label={tr('全局筛选条', 'Global filter bar')}>
          <div className={styles.filterTitle}>
            <FilterOutlined className={styles.filterTitleIcon} />
            {tr('全局筛选', 'Global filters')}
          </div>
          <div className={styles.filterBody}>
            <DashboardFilters
              filters={schema.filters}
              values={filters}
              scopeByFilter={filterScopes}
              showReset={false}
              variant='bar'
              onEditFilter={
                workspaceMode === 'edit'
                  ? filterId => {
                      focusManualEditor();
                      setSelectedFilterId(filterId);
                      setSelectedWidgetId(null);
                      setSettingsCollapsed(false);
                    }
                  : undefined
              }
              onChange={handleChangeFilters}
              onReset={handleResetFilters}
            />
          </div>
          <div className={styles.filterActions}>
            <span className={styles.liveBadge}>
              <span className={styles.liveDot} /> {tr('即时联动', 'Live updates')}
            </span>
            <Button
              loading={refreshing}
              onClick={() => handleResetFilters(initialDashboardFilterValues(schema.filters))}
            >
              {tr('重置筛选', 'Reset filters')}
            </Button>
          </div>
        </section>

        <div className={styles.workspace} ref={paneResize.workspaceRef}>
          {workspaceMode === 'edit' && !libraryCollapsed && (
            <div className={styles.paneResizeHandle} {...paneResize.separatorProps('left')} />
          )}
          {workspaceMode === 'edit' && !settingsCollapsed && (
            <div className={styles.paneResizeHandle} {...paneResize.separatorProps('right')} />
          )}
          {workspaceMode === 'edit' && !libraryCollapsed ? (
            <aside
              data-testid='dashboard-component-library'
              id={paneResize.leftId}
              style={{ width: paneResize.left }}
              className={`${styles.panel} ${styles.libraryPanel} ${libraryMode === 'assistant' ? styles.assistantPanel : ''}`}
              aria-label={tr('组件库与 AI 批注', 'Components and AI annotations')}
            >
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderText}>
                  <h2 className={styles.panelTitle}>{libraryMode === 'assistant' ? tr('AI 助手', 'AI assistant') : tr('组件库', 'Component library')}</h2>
                  <div className={styles.panelHint}>
                    {libraryMode === 'assistant' ? tr('围绕当前看板继续对话', 'Continue discussing this dashboard') : tr('点击添加到画布', 'Select to add to canvas')}
                  </div>
                </div>
                <Button
                  aria-label={tr('折叠组件库', 'Collapse component library')}
                  type='text'
                  size='small'
                  icon={<MenuFoldOutlined />}
                  onClick={() => setLibraryCollapsed(true)}
                />
              </div>
              <div className={styles.libraryBody}>
                <Segmented
                  block
                  size='small'
                  value={libraryMode}
                  options={[
                    { label: tr('组件', 'Components'), value: 'components', icon: <AppstoreOutlined /> },
                    {
                      label: tr('AI 助手', 'AI assistant'),
                      value: 'assistant',
                      icon: <CommentOutlined />,
                    },
                  ]}
                  onChange={value => setLibraryMode(value as LibraryMode)}
                />
                {libraryMode === 'assistant' ? (
                  <div className='mt-3 flex min-h-0 flex-1 flex-col'>
                    <DashboardAssistantConversation
                      messages={assistantSession.messages}
                      running={assistantRunning}
                      status={assistantStatus}
                      question={
                        pendingQuestion ? (
                          <QuestionDock
                            request={pendingQuestion}
                            onReply={async (id, answers) => {
                              await replyQuestion(id, answers);
                              setAssistantSession(current => ({
                                ...current,
                                messages: [
                                  ...current.messages,
                                  {
                                    id: `answer-${id}`,
                                    role: 'user',
                                    content: answers.map(items => items.join('、')).join('\n'),
                                  },
                                ],
                              }));
                            }}
                            onReject={rejectQuestion}
                          />
                        ) : null
                      }
                      savedCount={assistantSession.saved.length}
                      onShowAnnotations={() => setAnnotationTrayOpen(true)}
                      attachments={annotationAttachments}
                      onEditAttachment={editAnnotationDraft}
                      onRemoveAttachment={removeAnnotationDraft}
                      onLocateAnnotation={locateAnnotationTarget}
                      onSend={text => void sendAssistantMessage(text, annotationAttachments)}
                      onStop={() => assistantAbortRef.current?.abort()}
                      onRetry={() => {
                        const last = assistantRetryRef.current || assistantSession.lastRequest;
                        if (last) void sendAssistantMessage(last.text, last.drafts, true);
                      }}
                      proposals={assistantProposals}
                      applying={Boolean(applyingAnnotationId)}
                      onApplyBatch={() => void applyAssistantBatch()}
                      onPreview={item =>
                        setAnnotationSelection({
                          target: item.target,
                          anchor: new DOMRect(Math.max(24, window.innerWidth - 600), 160, 380, 180),
                        })
                      }
                    />
                  </div>
                ) : (
                  <>
                    <Input.Search
                      aria-label={tr('搜索图表类型', 'Search chart types')}
                      aria-expanded={chartPickerOpen}
                      onFocus={() => setChartPickerOpen(true)}
                      onSearch={() => setChartPickerOpen(true)}
                      onKeyDown={event => {
                        if (event.key === 'Escape') setChartPickerOpen(false);
                      }}
                      placeholder={tr('搜索图表类型…', 'Search chart types…')}
                      allowClear
                      value={chartSearch}
                      onChange={event => setChartSearch(event.target.value)}
                    />
                    {chartPickerOpen && (
                      <div className={styles.componentOptions} aria-label={tr('图表类型', 'Chart types')}>
                        {(Object.entries(visualizationNames) as [DashboardVisualization, string][])
                          .filter(([type, label]) => (label + visualizationLabel(type) + type).toLowerCase().includes(chartSearch.toLowerCase()))
                          .map(([type]) => (
                            <button
                              key={type}
                              type='button'
                              onClick={() => {
                                addVisualizationWidget(type);
                                setChartPickerOpen(false);
                              }}
                            >
                              {visualizationLabel(type)}
                              <PlusOutlined aria-hidden />
                            </button>
                          ))}
                        {!Object.entries(visualizationNames).some(([type, label]) =>
                          (label + visualizationLabel(type as DashboardVisualization) + type).toLowerCase().includes(chartSearch.toLowerCase()),
                        ) && <p>{tr('没有匹配的图表类型', 'No matching chart types')}</p>}
                      </div>
                    )}
                    <div className={styles.libraryTools}>
                      <Button
                        size='small'
                        onClick={() => {
                          const next = recommendedDashboardLayout(schema.widgets);
                          if (sameDesktopLayout(schema.layouts.desktop, next)) message.info(tr('当前已是推荐布局', 'The recommended layout is already applied'));
                          else {
                            setSchema(current => ({ ...current, layouts: { ...current.layouts, desktop: next } }));
                            message.success(tr('已恢复推荐布局', 'Recommended layout restored'));
                          }
                        }}
                      >
                        {tr('推荐布局', 'Recommended layout')}
                      </Button>
                      <Button
                        size='small'
                        onClick={() => {
                          const next = compactDashboardLayout(schema.layouts.desktop);
                          if (sameDesktopLayout(schema.layouts.desktop, next)) message.info(tr('当前已无多余空隙', 'The layout has no extra gaps'));
                          else {
                            setSchema(current => ({ ...current, layouts: { ...current.layouts, desktop: next } }));
                            message.success(tr('已紧凑排列组件', 'Widgets arranged compactly'));
                          }
                        }}
                      >
                        {tr('紧凑排列', 'Compact layout')}
                      </Button>
                    </div>
                    <Divider className={styles.librarySectionDivider} />
                    <DashboardThemePanel
                      theme={schema.dashboard.theme}
                      onChange={theme =>
                        setSchema(current => ({
                          ...current,
                          schema_version: '1.4',
                          dashboard: { ...current.dashboard, theme },
                        }))
                      }
                    />
                    <Divider className={styles.librarySectionDivider} />
                    <h3 className={styles.sectionTitle}>{tr('全局筛选器', 'Global filters')}</h3>
                    <Select
                      aria-label={tr('新增筛选器类型', 'New filter type')}
                      placeholder={tr('添加筛选器…', 'Add filter…')}
                      className={styles.librarySelect}
                      value={undefined}
                      options={[
                        { value: 'date_range', label: tr('日期范围', 'Date range') },
                        { value: 'select', label: tr('单选', 'Single select') },
                        { value: 'multi_select', label: tr('多选', 'Multiple select') },
                        { value: 'text', label: tr('文本', 'Text') },
                        { value: 'number_range', label: tr('数值范围', 'Number range') },
                      ]}
                      onChange={addFilter}
                    />
                    <div className='mt-3 space-y-2'>
                      {schema.filters.map(filter => (
                        <div
                          key={filter.id}
                          data-dashboard-filter-id={filter.id}
                          className={`flex items-center rounded border p-2 text-xs ${selectedFilterId === filter.id ? 'border-[var(--app-accent)] bg-[var(--app-accent-soft)]' : 'border-[var(--app-border)]'}`}
                        >
                          <button
                            type='button'
                            className='min-w-0 flex-1 truncate text-left'
                            onClick={() => {
                              setSelectedFilterId(filter.id);
                              setSelectedWidgetId(null);
                              setSettingsCollapsed(false);
                            }}
                          >
                            {filter.label}
                          </button>
                          <Button
                            type='link'
                            size='small'
                            icon={<EditOutlined />}
                            aria-label={tr(`编辑筛选器 ${filter.label}`, `Edit filter ${filter.label}`)}
                            onClick={event => {
                              event.stopPropagation();
                              setSelectedFilterId(filter.id);
                              setSelectedWidgetId(null);
                              setSettingsCollapsed(false);
                            }}
                          >
                            {tr('编辑', 'Edit')}
                          </Button>
                          <Tooltip title={tr('让数据助理配置这个筛选器', 'Ask the data assistant to configure this filter')}>
                            <Button
                              aria-label={tr(`让数据助理配置筛选器 ${filter.label}`, `Ask the assistant to configure ${filter.label}`)}
                              type='text'
                              size='small'
                              icon={<CommentOutlined />}
                              onClick={event => {
                                event.stopPropagation();
                                requestAgentFilterConfiguration(filter, event.currentTarget.getBoundingClientRect());
                              }}
                            />
                          </Tooltip>
                          <Button
                            type='text'
                            size='small'
                            danger
                            icon={<DeleteOutlined />}
                            onClick={event => {
                              event.stopPropagation();
                              removeFilter(filter.id);
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            </aside>
          ) : workspaceMode === 'edit' ? (
            <div className={`${styles.collapsedRail} ${styles.collapsedRailLeft}`}>
              <Tooltip title={tr('展开组件库', 'Expand component library')} placement='right'>
                <Button
                  aria-label={tr('展开组件库', 'Expand component library')}
                  type='text'
                  size='small'
                  icon={<MenuUnfoldOutlined />}
                  onClick={() => setLibraryCollapsed(false)}
                />
              </Tooltip>
            </div>
          ) : null}

          <main className={styles.canvasWrap}>
            {!isDirty &&
              !refreshing &&
              snapshot &&
              schema.widgets.length > 0 &&
              schema.widgets.every(
                w =>
                  !isWidgetQueryUnconfigured(w) &&
                  snapshot.widgets[w.id]?.rows.length > 0 &&
                  !snapshot.widgets[w.id].error,
              ) &&
              JSON.stringify(filters) === JSON.stringify(initialDashboardFilterValues(record.schema.filters)) && (
                <DashboardCoverCapture
                  key={`${record.id}:${record.current_revision}:${snapshot.refreshed_at}`}
                  record={record}
                  snapshot={snapshot}
                />
              )}
            {collaboration.pendingRemote && (
              <Alert
                className='mb-4'
                type='warning'
                showIcon
                message={tr(`远端已保存修订 ${collaboration.pendingRemote.current_revision}`, `Remote revision ${collaboration.pendingRemote.current_revision} saved`)}
                description={tr('本页也有尚未保存的修改，因此没有自动覆盖。你可以先复制需要保留的内容，再加载远端版本。', 'This page has unsaved changes, so the remote version was not loaded automatically. Copy any changes you need before loading it.')}
                action={<Button onClick={collaboration.acceptRemote}>{tr('加载远端版本', 'Load remote version')}</Button>}
              />
            )}
            <div className={styles.canvasToolbar}>
              <div>
                <span className={styles.canvasTitle}>{workspaceMode === 'edit' ? tr('编辑画布', 'Edit canvas') : tr('看板预览', 'Dashboard preview')}</span>
                <span className={styles.canvasSubtitle}>
                  {workspaceMode === 'edit'
                    ? tr('拖动标题到空白处；占用位置不会挤开其他组件。右下角可调整尺寸', 'Drag titles to empty spaces. Occupied positions do not displace widgets; resize from the lower-right corner.')
                    : tr('交互筛选仍可用，布局已锁定', 'Interactive filters remain available; layout is locked')}
                </span>
              </div>
              <div className={styles.canvasStatus}>
                <span>{tr(`${schema.widgets.length} 个组件`, `${schema.widgets.length} widgets`)}</span>
                <span className={styles.gridBadge}>12 COL</span>
              </div>
            </div>
            <DashboardRenderer
              filters={filters}
              onChangeFilters={handleChangeFilters}
              schema={schema}
              snapshot={snapshot}
              editable={workspaceMode === 'edit'}
              selectedWidgetId={workspaceMode === 'edit' ? selectedWidgetId : null}
              loadingWidgetIds={loadingWidgetIds}
              onSelectWidget={widgetId => {
                setSelectedWidgetId(widgetId);
                setSelectedFilterId(null);
                setWidgetSettingsMode('visual');
              }}
              onEditWidget={widgetId => {
                focusManualEditor();
                setSelectedWidgetId(widgetId);
                setSelectedFilterId(null);
                setSettingsCollapsed(false);
                setWidgetSettingsMode('visual');
              }}
              selectedEditorMode={widgetSettingsMode}
              onOpenWidgetQueryEditor={openWidgetQueryEditor}
              onRequestAgentWidgetConfiguration={(widgetId, anchor) => {
                const widget = schema.widgets.find(item => item.id === widgetId);
                if (widget) requestAgentWidgetConfiguration(widget, anchor);
              }}
              agentConfigurationDisabled={!assistantAvailable}
              onRetryWidget={handlePreview}
              annotationMode={workspaceMode === 'edit' && annotationMode}
              onSelectAnnotationTarget={handleAnnotationTarget}
              annotationDrafts={annotationDrafts}
              onEditAnnotationDraft={(id, anchor) => {
                const draft = annotationDrafts.find(item => item.id === id);
                if (draft) editAnnotationDraft(draft, anchor);
              }}
              onLayoutChange={desktop =>
                setSchema(current =>
                  sameDesktopLayout(current.layouts.desktop, desktop)
                    ? current
                    : { ...current, layouts: { ...current.layouts, desktop } },
                )
              }
            />
          </main>

          {workspaceMode === 'edit' && !settingsCollapsed ? (
            <aside
              data-testid='dashboard-settings-panel'
              id={paneResize.rightId}
              style={{ width: paneResize.right }}
              className={`${styles.panel} ${styles.settingsPanel}`}
              aria-label={tr('属性设置', 'Properties')}
            >
              <div className={styles.panelHeader}>
                <div className={styles.panelHeaderText}>
                  <h2 className={styles.panelTitle}>{tr('属性设置', 'Properties')}</h2>
                  <div
                    className={styles.panelHint}
                    title={selectedWidget?.title || selectedFilter?.label || tr('未选择组件或筛选器', 'No widget or filter selected')}
                  >
                    {tr('当前：', 'Current: ')}{selectedWidget?.title || selectedFilter?.label || tr('未选择', 'None selected')}
                  </div>
                </div>
                <Button
                  aria-label={tr('折叠属性设置', 'Collapse properties')}
                  type='text'
                  size='small'
                  icon={<RightOutlined />}
                  onClick={() => setSettingsCollapsed(true)}
                />
              </div>
              <div className={styles.settingsBody}>
                {selectedWidget ? (
                  <div className='space-y-4'>
                    <div className='flex items-center gap-2'>
                      <div className='min-w-0 flex-1'>
                        <strong className='block'>
                          {widgetSettingsMode === 'visual' ? tr('可视化设置', 'Visualization settings') : tr('计算逻辑与 SQL', 'Calculation logic and SQL')}
                        </strong>
                        <span className='block truncate text-xs text-[var(--app-accent)]'>
                          {tr('正在编辑：', 'Editing: ')}{selectedWidget.title}
                        </span>
                      </div>
                      <Button
                        aria-label={tr(`删除组件 ${selectedWidget.title}`, `Delete widget ${selectedWidget.title}`)}
                        danger
                        type='text'
                        icon={<DeleteOutlined />}
                        onClick={() => removeWidget(selectedWidget.id)}
                      />
                    </div>
                    {widgetSettingsMode === 'visual' && (
                      <>
                        {isWidgetQueryUnconfigured(selectedWidget) && (
                          <div
                            data-testid='dashboard-widget-setup-guide'
                            className='rounded-xl border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3'
                          >
                            <div className='flex items-start gap-2'>
                              <CommentOutlined className='mt-0.5 text-[var(--app-accent)]' />
                              <div className='min-w-0'>
                                <div className='text-sm font-medium text-[var(--app-accent)]'>{tr('尚未配置查询', 'Query not configured')}</div>
                                <div className='mt-1 text-xs leading-5 text-[var(--app-accent)]'>
                                  {tr('该组件还没有数据查询。可让数据助理结合当前数据源自动生成，也可直接编辑 SQL。', 'This widget has no data query. Ask the assistant to generate one or edit SQL directly.')}
                                </div>
                              </div>
                            </div>
                            <div className='mt-3 grid gap-2'>
                              <Button
                                block
                                size='small'
                                type='primary'
                                aria-label={tr('让数据助理配置', 'Ask data assistant to configure')}
                                icon={<CommentOutlined />}
                                disabled={!assistantAvailable}
                                onClick={event =>
                                  requestAgentWidgetConfiguration(
                                    selectedWidget,
                                    event.currentTarget.getBoundingClientRect(),
                                  )
                                }
                              >
                                {tr('让数据助理配置', 'Ask data assistant to configure')}
                              </Button>
                              <Button
                                block
                                size='small'
                                aria-label={tr('手动配置 SQL', 'Configure SQL manually')}
                                icon={<CodeOutlined />}
                                onClick={() => openWidgetQueryEditor(selectedWidget.id)}
                              >
                                {tr('手动配置 SQL', 'Configure SQL manually')}
                              </Button>
                            </div>
                            {!assistantAvailable && (
                              <div className='mt-2 text-[11px] leading-4 text-[var(--app-muted)]'>
                                {tr('此看板没有可续接的数据助理任务，请使用手动配置。', 'No data assistant task is available. Configure it manually.')}
                              </div>
                            )}
                          </div>
                        )}
                        <label className='block text-xs text-[var(--app-muted)]'>
                          {tr('标题', 'Title')}
                          <Input
                            value={selectedWidget.title}
                            onChange={event =>
                              replaceWidget(selectedWidget.id, widget => ({ ...widget, title: event.target.value }))
                            }
                          />
                        </label>
                        <label className='block text-xs text-[var(--app-muted)]'>
                          {tr('副标题（可选）', 'Subtitle (optional)')}
                          <Input
                            value={selectedWidget.description}
                            onChange={event =>
                              replaceWidget(selectedWidget.id, widget => ({
                                ...widget,
                                description: event.target.value,
                              }))
                            }
                          />
                        </label>
                        <label className='block text-xs text-[var(--app-muted)]'>
                          {tr('展示形式（Schema 1.3）', 'Visualization (Schema 1.3)')}
                          <Select
                            className='w-full'
                            value={selectedVisualization || undefined}
                            options={(Object.keys(visualizationNames) as DashboardVisualization[]).map(
                              visualization => ({
                                value: visualization,
                                label: visualizationLabel(visualization),
                              }),
                            )}
                            onChange={visualization => setWidgetVisualization(selectedWidget.id, visualization)}
                          />
                        </label>
                        <div className='space-y-3 rounded-lg border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3'>
                          <div className='flex items-center gap-2 text-xs font-semibold text-[var(--app-text)]'>
                            <BgColorsOutlined className='text-[var(--app-accent)]' />
                            {tr('图表样式与颜色', 'Chart style and colors')}
                          </div>
                          <label className='block text-xs text-[var(--app-muted)]'>
                            {tr('配色方案', 'Color palette')}
                            <Select
                              aria-label={tr('配色方案', 'Color palette')}
                              className='mt-1 w-full'
                              value={detectDashboardPalette(selectedWidget.presentation?.colors)}
                              options={[
                                ...(Object.keys(DASHBOARD_PALETTES) as DashboardPaletteId[]).map(id => ({
                                  value: id,
                                  label: tr(DASHBOARD_PALETTES[id].label, paletteEnglish[id] || id),
                                })),
                                { value: 'custom', label: tr('自定义颜色', 'Custom colors') },
                              ]}
                              onChange={value => {
                                if (value !== 'custom') setWidgetPalette(value as DashboardPaletteId);
                              }}
                            />
                          </label>
                          <div className='grid grid-cols-[minmax(0,1fr)_92px] gap-3'>
                            <label className='block text-xs text-[var(--app-muted)]'>
                              {tr('字体', 'Font')}
                              <Select
                                aria-label={tr('图表字体', 'Chart font')}
                                className='mt-1 w-full'
                                value={String(selectedWidget.style.fontFamily || 'system-ui')}
                                options={[
                                  { value: 'system-ui', label: tr('系统字体', 'System font') },
                                  { value: 'Arial, sans-serif', label: 'Arial' },
                                  { value: '"Microsoft YaHei", sans-serif', label: tr('微软雅黑', 'Microsoft YaHei') },
                                  { value: '"Noto Sans SC", sans-serif', label: tr('思源黑体', 'Noto Sans SC') },
                                ]}
                                onChange={value => updateStyle('fontFamily', value)}
                              />
                            </label>
                            <label className='block text-xs text-[var(--app-muted)]'>
                              {tr('标题字号', 'Title font size')}
                              <InputNumber
                                aria-label={tr('图表标题字号', 'Chart title font size')}
                                className='mt-1 w-full'
                                min={12}
                                max={32}
                                value={Number(selectedWidget.style.fontSize ?? 14)}
                                onChange={value => updateStyle('fontSize', value ?? 14)}
                              />
                            </label>
                          </div>
                          <div>
                            <div className='mb-1 text-xs text-[var(--app-muted)]'>{tr('主色与系列色', 'Primary and series colors')}</div>
                            <div className='flex flex-wrap gap-2'>
                              {(selectedWidget.presentation?.colors.length
                                ? selectedWidget.presentation.colors
                                : [...DASHBOARD_PALETTES.businessBlue.colors]
                              )
                                .slice(0, 6)
                                .map((color, index) => (
                                  <label
                                    key={`${index}-${color}`}
                                    className='relative h-8 w-8 cursor-pointer overflow-hidden rounded-full border-2 border-[var(--app-border)] shadow ring-1 ring-[var(--app-border)]'
                                    title={tr(`颜色 ${index + 1}：${color}`, `Color ${index + 1}: ${color}`)}
                                    style={{ backgroundColor: color }}
                                  >
                                    <input
                                      aria-label={tr(`编辑颜色 ${index + 1}`, `Edit color ${index + 1}`)}
                                      type='color'
                                      className='absolute inset-0 h-full w-full cursor-pointer opacity-0'
                                      value={color}
                                      onChange={event =>
                                        updatePresentation(
                                          'colors',
                                          replacePaletteColor(
                                            selectedWidget.presentation?.colors,
                                            index,
                                            event.target.value,
                                          ),
                                        )
                                      }
                                    />
                                  </label>
                                ))}
                            </div>
                          </div>
                          <div className='grid grid-cols-2 gap-x-3 gap-y-2'>
                            <label className='flex items-center justify-between text-xs text-[var(--app-muted)]'>
                              {tr('显示网格线', 'Show gridlines')}
                              <Switch
                                size='small'
                                checked={selectedWidget.presentation?.show_grid ?? true}
                                onChange={value => updatePresentation('show_grid', value)}
                              />
                            </label>
                            <label className='flex items-center justify-between text-xs text-[var(--app-muted)]'>
                              {tr('显示图例', 'Show legend')}
                              <Switch
                                size='small'
                                checked={selectedWidget.presentation?.show_legend ?? true}
                                onChange={value => updatePresentation('show_legend', value)}
                              />
                            </label>
                            {selectedVisualization && ['line', 'area'].includes(selectedVisualization) && (
                              <label className='flex items-center justify-between text-xs text-[var(--app-muted)]'>
                                {tr('平滑曲线', 'Smooth curve')}
                                <Switch
                                  size='small'
                                  checked={selectedWidget.presentation?.smooth ?? true}
                                  onChange={value => updatePresentation('smooth', value)}
                                />
                              </label>
                            )}
                            {selectedVisualization &&
                              ['column', 'bar', 'stacked_column'].includes(selectedVisualization) && (
                                <label className='flex items-center justify-between text-xs text-[var(--app-muted)]'>
                                  {tr('堆叠展示', 'Stack series')}
                                  <Switch
                                    size='small'
                                    checked={
                                      selectedVisualization === 'stacked_column' || selectedWidget.presentation?.stacked
                                    }
                                    onChange={value => updatePresentation('stacked', value)}
                                  />
                                </label>
                              )}
                            {selectedVisualization && ['kpi', 'gauge'].includes(selectedVisualization) && (
                              <label className='flex items-center justify-between text-xs text-[var(--app-muted)]'>
                                {tr('百分比格式', 'Percentage format')}
                                <Switch
                                  size='small'
                                  checked={selectedWidget.presentation?.percentage ?? false}
                                  onChange={value => updatePresentation('percentage', value)}
                                />
                              </label>
                            )}
                          </div>
                        </div>
                        {(supportsTopN || supportsNumericFormatting) && (
                          <div className='grid grid-cols-2 gap-3 rounded-lg border border-[var(--app-border)] p-3'>
                            {supportsTopN && (
                              <label className='text-xs text-[var(--app-muted)]'>
                                {tr('显示前 N 项', 'Show top N')}
                                <InputNumber
                                  className='mt-1 w-full'
                                  min={1}
                                  max={100}
                                  value={selectedWidget.presentation?.top_n ?? 10}
                                  placeholder={tr('默认 10', 'Default 10')}
                                  onChange={value => updatePresentation('top_n', value ?? 10)}
                                />
                              </label>
                            )}
                            {supportsNumericFormatting && (
                              <>
                                <label className='text-xs text-[var(--app-muted)]'>
                                  {tr('小数位', 'Decimal places')}
                                  <InputNumber
                                    className='mt-1 w-full'
                                    min={0}
                                    max={20}
                                    value={selectedWidget.presentation?.precision ?? null}
                                    placeholder={tr('自动', 'Automatic')}
                                    onChange={value => updatePresentation('precision', value)}
                                  />
                                </label>
                                <label className='text-xs text-[var(--app-muted)]'>
                                  {tr('单位', 'Unit')}
                                  <Input
                                    className='mt-1'
                                    value={selectedWidget.presentation?.unit || ''}
                                    placeholder={tr('例如：万元', 'For example: USD')}
                                    onChange={event => updatePresentation('unit', event.target.value || null)}
                                  />
                                </label>
                                <label className='text-xs text-[var(--app-muted)]'>
                                  {tr('货币符号', 'Currency symbol')}
                                  <Input
                                    className='mt-1'
                                    value={selectedWidget.presentation?.currency || ''}
                                    placeholder={tr('例如：¥ / $', 'For example: ¥ / $')}
                                    onChange={event => updatePresentation('currency', event.target.value || null)}
                                  />
                                </label>
                              </>
                            )}
                          </div>
                        )}
                        <Divider className='my-2' />
                        <div className='text-xs font-semibold text-[var(--app-muted)]'>{tr('图表字段设置', 'Chart field settings')}</div>
                        {(selectedVisualization === 'kpi' || selectedVisualization === 'gauge') && (
                          <Select
                            showSearch
                            optionFilterProp='label'
                            className='w-full'
                            placeholder={tr('数值字段', 'Value field')}
                            value={selectedWidget.encoding.value}
                            options={selectedOutputFieldOptions}
                            onChange={value => updateEncoding('value', value)}
                          />
                        )}
                        {selectedVisualization === 'gauge' && (
                          <Select
                            allowClear
                            showSearch
                            optionFilterProp='label'
                            className='w-full'
                            placeholder={tr('目标字段（可选）', 'Target field (optional)')}
                            value={selectedWidget.encoding.target}
                            options={selectedOutputFieldOptions}
                            onChange={value => updateEncoding('target', value)}
                          />
                        )}
                        {selectedVisualization &&
                          [
                            'line',
                            'area',
                            'column',
                            'bar',
                            'stacked_column',
                            'scatter',
                            'dual_axis',
                            'funnel',
                            'treemap',
                            'radar',
                            'waterfall',
                            'geo_map',
                          ].includes(selectedVisualization) && (
                            <Space direction='vertical' className='w-full'>
                              <Select
                                showSearch
                                optionFilterProp='label'
                                className='w-full'
                                placeholder={cartesianFieldLabels?.x || tr('X 轴', 'X axis')}
                                value={selectedWidget.encoding.x}
                                options={selectedOutputFieldOptions}
                                onChange={value => updateEncoding('x', value)}
                              />
                              <Select
                                showSearch
                                optionFilterProp='label'
                                className='w-full'
                                placeholder={cartesianFieldLabels?.y || tr('Y 轴', 'Y axis')}
                                value={selectedWidget.encoding.y}
                                options={selectedOutputFieldOptions}
                                onChange={value => updateEncoding('y', value)}
                              />
                              {cartesianFieldLabels?.series !== '' && (
                                <Select
                                  allowClear
                                  showSearch
                                  optionFilterProp='label'
                                  className='w-full'
                                  placeholder={cartesianFieldLabels?.series || tr('系列（可选）', 'Series (optional)')}
                                  value={selectedWidget.encoding.series}
                                  options={selectedOutputFieldOptions}
                                  onChange={value => updateEncoding('series', value)}
                                />
                              )}
                            </Space>
                          )}
                        {selectedVisualization === 'dual_axis' && (
                          <Select
                            showSearch
                            optionFilterProp='label'
                            className='w-full'
                            placeholder={tr('第二数值字段', 'Second value field')}
                            value={selectedWidget.encoding.y2}
                            options={selectedOutputFieldOptions}
                            onChange={value => updateEncoding('y2', value)}
                          />
                        )}
                        {(selectedVisualization === 'pie' || selectedVisualization === 'donut') && (
                          <Space direction='vertical' className='w-full'>
                            <Select
                              showSearch
                              optionFilterProp='label'
                              className='w-full'
                              placeholder={tr('分类字段', 'Category field')}
                              value={selectedWidget.encoding.color || selectedWidget.encoding.category}
                              options={selectedOutputFieldOptions}
                              onChange={value => updateEncoding('color', value)}
                            />
                            <Select
                              showSearch
                              optionFilterProp='label'
                              className='w-full'
                              placeholder={tr('数值字段', 'Value field')}
                              value={selectedWidget.encoding.angle}
                              options={selectedOutputFieldOptions}
                              onChange={value => updateEncoding('angle', value)}
                            />
                          </Space>
                        )}
                        {selectedVisualization === 'cohort' && (
                          <Space direction='vertical' className='w-full'>
                            {(
                              [
                                { name: 'row', label: tr('首次购买周期', 'First purchase period') },
                                { name: 'column', label: tr('经过周期数（从 0 开始）', 'Periods elapsed (starting at 0)') },
                                { name: 'value', label: tr('当期购买客户数', 'Purchasing customers in period') },
                                { name: 'target', label: tr('首购客户数（分母）', 'First-purchase customers (denominator)') },
                                { name: 'color', label: tr('已观察标识（1 已覆盖 / 0 未到期）', 'Observed flag (1 covered / 0 not due)') },
                              ] as const
                            ).map(({ name, label }) => (
                              <label key={name} className='block w-full text-xs'>
                                {label}
                                <Select
                                  aria-label={label}
                                  showSearch
                                  optionFilterProp='label'
                                  className='mt-1 w-full'
                                  value={selectedWidget.encoding[name]}
                                  options={selectedOutputFieldOptions}
                                  onChange={value => updateEncoding(name, value)}
                                />
                              </label>
                            ))}
                          </Space>
                        )}
                        {selectedVisualization === 'heatmap' && (
                          <Space direction='vertical' className='w-full'>
                            {(['row', 'column', 'value'] as const).map((name, index) => (
                              <Select
                                key={name}
                                showSearch
                                optionFilterProp='label'
                                className='w-full'
                                placeholder={index === 0 ? tr('行维度', 'Row dimension') : index === 1 ? tr('列维度', 'Column dimension') : tr('颜色数值', 'Color value')}
                                value={selectedWidget.encoding[name]}
                                options={selectedOutputFieldOptions}
                                onChange={value => updateEncoding(name, value)}
                              />
                            ))}
                          </Space>
                        )}
                        {selectedVisualization === 'table' && (
                          <Space direction='vertical' className='w-full'>
                            <Select
                              mode='multiple'
                              showSearch
                              optionFilterProp='label'
                              className='w-full'
                              placeholder={tr('显示列（可搜索）', 'Displayed columns (searchable)')}
                              value={selectedWidget.encoding.columns}
                              options={selectedOutputFieldOptions}
                              onChange={value => updateEncoding('columns', value)}
                            />
                            {(selectedWidget.encoding.columns || []).map(fieldName => {
                              const field = selectedWidget.query.output_fields.find(item => item.name === fieldName);
                              if (!field) return null;
                              return (
                                <label key={fieldName} className='block text-xs text-[var(--app-muted)]'>
                                  {tr(`${fieldName} 的显示名称`, `Display name for ${fieldName}`)}
                                  <Input
                                    className='mt-1'
                                    value={field.label || ''}
                                    placeholder={fieldName}
                                    onChange={event => updateOutputFieldLabel(fieldName, event.target.value)}
                                  />
                                </label>
                              );
                            })}
                            <Space.Compact block>
                              <Select
                                allowClear
                                showSearch
                                optionFilterProp='label'
                                className='flex-1'
                                placeholder={tr('默认排序字段（可选）', 'Default sort field (optional)')}
                                value={selectedWidget.presentation?.default_sort.field || undefined}
                                options={selectedOutputFieldOptions}
                                onChange={value =>
                                  updatePresentation('default_sort', {
                                    field: value || null,
                                    direction: value
                                      ? selectedWidget.presentation?.default_sort.direction === 'default'
                                        ? 'ascending'
                                        : selectedWidget.presentation?.default_sort.direction || 'ascending'
                                      : 'default',
                                  })
                                }
                              />
                              <Select
                                className='w-28'
                                value={selectedWidget.presentation?.default_sort.direction || 'default'}
                                options={[
                                  { value: 'default', label: tr('原始顺序', 'Original order') },
                                  { value: 'ascending', label: tr('升序', 'Ascending') },
                                  { value: 'descending', label: tr('降序', 'Descending') },
                                ]}
                                onChange={direction =>
                                  updatePresentation('default_sort', {
                                    field: selectedWidget.presentation?.default_sort.field || null,
                                    direction,
                                  })
                                }
                              />
                            </Space.Compact>
                          </Space>
                        )}
                        <Divider className='my-2' />
                        <DashboardAnomalyRuleEditor
                          rules={selectedWidget.anomaly_rules || []}
                          fields={selectedWidget.query.output_fields.map(field => ({
                            value: field.name,
                            label: field.label || (field.name === 'value' ? selectedWidget.title : field.name),
                            type: field.type,
                          }))}
                          result={snapshot?.widgets[selectedWidget.id]}
                          onChange={anomalyRules =>
                            replaceWidget(selectedWidget.id, widget => ({ ...widget, anomaly_rules: anomalyRules }))
                          }
                        />
                      </>
                    )}
                    {widgetSettingsMode === 'query' && (
                      <>
                        <DashboardQueryLogicPanel
                          dashboardId={record.id}
                          widget={selectedWidget}
                          filters={schema.filters}
                          values={filters}
                        />
                        <details
                          key={selectedWidget.id}
                          className='rounded-lg border border-[var(--app-border)] p-3'
                          data-testid='query-advanced-settings'
                        >
                          <summary className='cursor-pointer text-sm font-medium'>{tr('高级数据设置', 'Advanced data settings')}</summary>
                          <div className='mt-4 space-y-4'>
                            <Alert
                              type='info'
                              showIcon
                              message={tr('SQL 与数据设置', 'SQL and data settings')}
                              description={tr('在这里维护该组件的参数化 SQL、输出字段、筛选参数、行数限制和分享页筛选绑定。查询仍会经过后端只读安全校验。', 'Configure parameterized SQL, output fields, filters, row limits and share-page bindings. Queries remain subject to backend read-only validation.')}
                            />
                            <label className='block text-xs text-[var(--app-muted)]'>
                              {tr('输出字段（逗号分隔）', 'Output fields (comma-separated)')}
                              <Input
                                value={selectedWidget.query.output_fields.map(field => field.name).join(', ')}
                                onChange={event => {
                                  replaceWidget(selectedWidget.id, widget =>
                                    updateWidgetOutputFields(widget, event.target.value.split(',')),
                                  );
                                }}
                              />
                            </label>
                            <div className='space-y-4 rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3'>
                              {selectedWidget.query.federation ? (
                                <Alert
                                  type='warning'
                                  showIcon
                                  message={tr('这是旧版本的高级跨数据源组件', 'This is a legacy cross-source widget')}
                                  description={tr('普通编辑器不再暴露跨数据源原始配置。请保留现有组件，或让数据助理基于当前单一数据源重新生成。', 'The editor does not expose raw cross-source configuration. Keep this widget or regenerate it using the current data source.')}
                                />
                              ) : (
                                <>
                                  <div className='text-xs font-semibold text-[var(--app-muted)]'>{tr('全局筛选器参数', 'Global filter parameters')}</div>
                                  {schema.filters.length ? (
                                    schema.filters.map(filter => {
                                      const binding = selectedWidget.query.filter_parameters[filter.id];
                                      const range = typeof binding === 'object' ? binding : {};
                                      return (
                                        <div key={filter.id} className='rounded border border-[var(--app-border)] p-2'>
                                          <div className='mb-1 text-xs'>{filter.label}</div>
                                          {filter.type === 'date_range' ? (
                                            <Space.Compact>
                                              <Input
                                                placeholder={tr('开始参数', 'Start parameter')}
                                                value={(range as FilterParameterBinding).start_parameter || ''}
                                                onChange={event =>
                                                  setFilterBinding(filter, {
                                                    ...(range as FilterParameterBinding),
                                                    start_parameter: event.target.value,
                                                  })
                                                }
                                              />
                                              <Input
                                                placeholder={tr('结束参数', 'End parameter')}
                                                value={(range as FilterParameterBinding).end_parameter || ''}
                                                onChange={event =>
                                                  setFilterBinding(filter, {
                                                    ...(range as FilterParameterBinding),
                                                    end_parameter: event.target.value,
                                                  })
                                                }
                                              />
                                            </Space.Compact>
                                          ) : (
                                            <Input
                                              placeholder={tr('SQL 参数名', 'SQL parameter name')}
                                              value={
                                                typeof binding === 'string'
                                                  ? binding
                                                  : (range as FilterParameterBinding).parameter || ''
                                              }
                                              onChange={event => setFilterBinding(filter, event.target.value)}
                                            />
                                          )}
                                        </div>
                                      );
                                    })
                                  ) : (
                                    <span className='text-xs text-[var(--app-muted)]'>{tr('暂无筛选器', 'No filters')}</span>
                                  )}
                                  <Divider className='my-2' />
                                  <div ref={queryEditorRef} data-testid='dashboard-query-editor'>
                                    <label className='block text-xs text-[var(--app-muted)]'>
                                      {tr('参数化 SQL', 'Parameterized SQL')}
                                      <Input.TextArea
                                        data-testid='dashboard-query-sql-input'
                                        className='font-mono text-xs'
                                        autoSize={{ minRows: 7, maxRows: 18 }}
                                        value={selectedWidget.query.sql || ''}
                                        onChange={event =>
                                          replaceWidget(selectedWidget.id, widget => ({
                                            ...widget,
                                            query: { ...widget.query, sql: event.target.value },
                                          }))
                                        }
                                      />
                                    </label>
                                  </div>
                                  <Space.Compact block>
                                    <label className='block flex-1 text-xs text-[var(--app-muted)]'>
                                      {tr('最多返回行数', 'Maximum rows')}
                                      <Input
                                        type='number'
                                        min={1}
                                        max={1000}
                                        value={selectedWidget.query.max_rows}
                                        onChange={event =>
                                          replaceWidget(selectedWidget.id, widget => ({
                                            ...widget,
                                            query: {
                                              ...widget.query,
                                              max_rows: Math.max(1, Math.min(1000, Number(event.target.value) || 1)),
                                            },
                                          }))
                                        }
                                      />
                                    </label>
                                    <div className='flex flex-1 items-end pb-2 pl-3 text-xs text-[var(--app-muted)]'>
                                      {tr('明细查询最多 1000 行；执行超时由后端统一控制。', 'Detail queries return at most 1,000 rows; timeouts are controlled by the backend.')}
                                    </div>
                                  </Space.Compact>
                                  <Divider className='my-2' />
                                  <details
                                    data-testid='dashboard-publication-binding-settings'
                                    className='rounded-lg border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3'
                                  >
                                    <summary className='cursor-pointer text-sm font-semibold text-[var(--app-accent)]'>
                                      {tr('分享页筛选数据绑定', 'Share-page filter binding')}
                                    </summary>
                                    <div className='mt-3 space-y-3'>
                                      {!selectedWidget.publication ? (
                                        <Alert
                                          type='warning'
                                          showIcon
                                          message={tr('尚未配置，当前组件不能发布为可交互筛选快照', 'Not configured; this widget cannot be published as an interactive snapshot')}
                                          description={
                                            <Space direction='vertical' size={8}>
                                              <span>
                                                {tr('发布页不会连接原数据库。需要先定义一条受限的发布查询，把筛选字段和指标原料冻结到快照中。', 'The published page does not access the source database. Define a bounded query to freeze filter fields and metric inputs in the snapshot.')}
                                              </span>
                                              <Button
                                                type='primary'
                                                size='small'
                                                aria-label={tr('创建发布筛选绑定', 'Create publication filter binding')}
                                                onClick={initializePublicationBinding}
                                              >
                                                {tr('创建发布筛选绑定', 'Create publication filter binding')}
                                              </Button>
                                            </Space>
                                          }
                                        />
                                      ) : (
                                        <>
                                          <Alert
                                            type='info'
                                            showIcon
                                            message={tr('发布时冻结受限数据集，匿名筛选只在快照中计算', 'Publishing freezes a bounded dataset; anonymous filters operate only on the snapshot')}
                                            description={tr('发布查询应返回筛选维度、分组字段和指标原料，不要包含筛选占位符。匿名分享页不会访问数据库、凭据或普通组件 SQL。', 'The publication query should return filter dimensions, grouping fields and metric inputs without filter placeholders. The share page does not access the database, credentials or normal widget SQL.')}
                                          />
                                          <label className='block text-xs text-[var(--app-muted)]'>
                                            {tr('发布数据 SQL（无筛选条件、只读且有界）', 'Publication SQL (unfiltered, read-only and bounded)')}
                                            <Input.TextArea
                                              data-testid='dashboard-publication-query-sql-input'
                                              className='mt-1 font-mono text-xs'
                                              autoSize={{ minRows: 6, maxRows: 16 }}
                                              value={selectedWidget.publication.query.sql ?? ''}
                                              onChange={event =>
                                                updatePublicationBinding(binding => ({
                                                  ...binding,
                                                  query: { ...binding.query, sql: event.target.value },
                                                }))
                                              }
                                            />
                                          </label>
                                          <label className='block text-xs text-[var(--app-muted)]'>
                                            {tr('发布数据字段（输入名称后按回车）', 'Publication data fields (press Enter after each name)')}
                                            <Select
                                              mode='tags'
                                              showSearch
                                              optionFilterProp='label'
                                              className='mt-1 w-full'
                                              tokenSeparators={[',']}
                                              value={selectedWidget.publication.query.output_fields.map(
                                                field => field.name,
                                              )}
                                              options={selectedPublicationFieldOptions}
                                              onChange={updatePublicationOutputFields}
                                            />
                                          </label>
                                          <div className='space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2'>
                                            <div className='text-xs font-semibold text-[var(--app-text)]'>
                                              {tr('全局筛选器对应的发布字段', 'Publication fields for global filters')}
                                            </div>
                                            {schema.filters.length ? (
                                              schema.filters.map(filter => {
                                                const configured = selectedWidget.publication?.filter_fields[filter.id];
                                                const field =
                                                  typeof configured === 'string' ? configured : configured?.field;
                                                const operator =
                                                  typeof configured === 'object' ? configured.operator : 'auto';
                                                return (
                                                  <div
                                                    key={filter.id}
                                                    className='grid grid-cols-[minmax(96px,0.8fr)_minmax(120px,1.4fr)_110px] items-end gap-2'
                                                  >
                                                    <span className='pb-2 text-xs text-[var(--app-text)]'>
                                                      {filter.label}
                                                    </span>
                                                    <Select
                                                      allowClear
                                                      showSearch
                                                      optionFilterProp='label'
                                                      placeholder={tr('不影响此组件', 'Does not affect this widget')}
                                                      value={field || undefined}
                                                      options={selectedPublicationFieldOptions}
                                                      onChange={value =>
                                                        updatePublicationBinding(binding => {
                                                          const filterFields = { ...binding.filter_fields };
                                                          if (value) {
                                                            filterFields[filter.id] = {
                                                              field: value,
                                                              operator: operator || 'auto',
                                                            };
                                                          } else {
                                                            delete filterFields[filter.id];
                                                          }
                                                          return { ...binding, filter_fields: filterFields };
                                                        })
                                                      }
                                                    />
                                                    <Select
                                                      disabled={!field}
                                                      value={operator || 'auto'}
                                                      options={[
                                                        { value: 'auto', label: tr('自动', 'Automatic') },
                                                        { value: 'equal', label: tr('等于', 'Equals') },
                                                        { value: 'less_than_or_equal', label: tr('小于等于', 'Less than or equal') },
                                                        { value: 'greater_than_or_equal', label: tr('大于等于', 'Greater than or equal') },
                                                      ]}
                                                      onChange={value =>
                                                        updatePublicationBinding(binding => ({
                                                          ...binding,
                                                          filter_fields: {
                                                            ...binding.filter_fields,
                                                            [filter.id]: {
                                                              field: field || '',
                                                              operator: value,
                                                            },
                                                          },
                                                        }))
                                                      }
                                                    />
                                                  </div>
                                                );
                                              })
                                            ) : (
                                              <span className='text-xs text-[var(--app-muted)]'>
                                                {tr('当前看板没有全局筛选器。', 'This dashboard has no global filters.')}
                                              </span>
                                            )}
                                          </div>
                                          <div className='flex items-center justify-between rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2'>
                                            <div>
                                              <div className='text-xs font-semibold text-[var(--app-text)]'>
                                                {tr('明细行模式', 'Detail row mode')}
                                              </div>
                                              <div className='text-xs text-[var(--app-muted)]'>
                                                {tr('表格通常开启；图表通常关闭并使用分组与指标聚合。', 'Usually enabled for tables; charts generally use groups and metric aggregation.')}
                                              </div>
                                            </div>
                                            <Switch
                                              checked={selectedWidget.publication.row_mode}
                                              onChange={rowMode =>
                                                updatePublicationBinding(binding => ({
                                                  ...binding,
                                                  row_mode: rowMode,
                                                  group_by: rowMode ? [] : binding.group_by,
                                                  measures: rowMode ? [] : binding.measures,
                                                }))
                                              }
                                            />
                                          </div>
                                          {!selectedWidget.publication.row_mode && (
                                            <div className='space-y-3 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2'>
                                              <label className='block text-xs text-[var(--app-muted)]'>
                                                {tr('分组字段', 'Group fields')}
                                                <Select
                                                  mode='multiple'
                                                  showSearch
                                                  optionFilterProp='label'
                                                  className='mt-1 w-full'
                                                  placeholder={tr('例如月份、门店或类别', 'For example: month, store or category')}
                                                  value={selectedWidget.publication.group_by}
                                                  options={selectedPublicationFieldOptions}
                                                  onChange={groupBy =>
                                                    updatePublicationBinding(binding => ({
                                                      ...binding,
                                                      group_by: groupBy,
                                                    }))
                                                  }
                                                />
                                              </label>
                                              <div className='space-y-2'>
                                                <div className='text-xs font-semibold text-[var(--app-text)]'>
                                                  {tr('指标聚合', 'Metric aggregations')}
                                                </div>
                                                {selectedWidget.publication.measures.map((measure, index) => (
                                                  <div key={`${measure.output_field}-${index}`} className='space-y-1'>
                                                    <Space.Compact block>
                                                      <Select
                                                        showSearch
                                                        optionFilterProp='label'
                                                        className='min-w-0 flex-1'
                                                        placeholder={tr('原料字段', 'Input field')}
                                                        value={measure.source_field || undefined}
                                                        options={selectedPublicationFieldOptions}
                                                        onChange={sourceField =>
                                                          updatePublicationBinding(binding => ({
                                                            ...binding,
                                                            measures: binding.measures.map((item, itemIndex) =>
                                                              itemIndex === index
                                                                ? { ...item, source_field: sourceField }
                                                                : item,
                                                            ),
                                                          }))
                                                        }
                                                      />
                                                      <Select
                                                        showSearch
                                                        optionFilterProp='label'
                                                        className='min-w-0 flex-1'
                                                        placeholder={tr('输出字段', 'Output field')}
                                                        value={measure.output_field || undefined}
                                                        options={selectedOutputFieldOptions}
                                                        onChange={outputField =>
                                                          updatePublicationBinding(binding => ({
                                                            ...binding,
                                                            measures: binding.measures.map((item, itemIndex) =>
                                                              itemIndex === index
                                                                ? { ...item, output_field: outputField }
                                                                : item,
                                                            ),
                                                          }))
                                                        }
                                                      />
                                                      <Select
                                                        className='w-28'
                                                        value={measure.aggregation}
                                                        options={publicationAggregationOptions.map(option => ({ ...option, label: tr(option.label, aggregationEnglish[option.value]) }))}
                                                        onChange={aggregation =>
                                                          updatePublicationBinding(binding => ({
                                                            ...binding,
                                                            measures: binding.measures.map((item, itemIndex) =>
                                                              itemIndex === index ? { ...item, aggregation } : item,
                                                            ),
                                                          }))
                                                        }
                                                      />
                                                      <Button
                                                        danger
                                                        icon={<DeleteOutlined />}
                                                        aria-label={tr('删除指标聚合', 'Delete metric aggregation')}
                                                        onClick={() =>
                                                          updatePublicationBinding(binding => ({
                                                            ...binding,
                                                            measures: binding.measures.filter(
                                                              (_, itemIndex) => itemIndex !== index,
                                                            ),
                                                          }))
                                                        }
                                                      />
                                                    </Space.Compact>
                                                    {measure.aggregation === 'ratio' && (
                                                      <Space.Compact block>
                                                        <Select
                                                          showSearch
                                                          optionFilterProp='label'
                                                          className='min-w-0 flex-1'
                                                          placeholder={tr('分母字段', 'Denominator field')}
                                                          value={measure.denominator_field || undefined}
                                                          options={selectedPublicationFieldOptions}
                                                          onChange={denominatorField =>
                                                            updatePublicationBinding(binding => ({
                                                              ...binding,
                                                              measures: binding.measures.map((item, itemIndex) =>
                                                                itemIndex === index
                                                                  ? { ...item, denominator_field: denominatorField }
                                                                  : item,
                                                              ),
                                                            }))
                                                          }
                                                        />
                                                        <InputNumber
                                                          className='w-28'
                                                          min={0.000001}
                                                          max={1000000}
                                                          placeholder={tr('倍率', 'Multiplier')}
                                                          value={measure.scale ?? 1}
                                                          onChange={scale =>
                                                            updatePublicationBinding(binding => ({
                                                              ...binding,
                                                              measures: binding.measures.map((item, itemIndex) =>
                                                                itemIndex === index
                                                                  ? { ...item, scale: Number(scale || 1) }
                                                                  : item,
                                                              ),
                                                            }))
                                                          }
                                                        />
                                                      </Space.Compact>
                                                    )}
                                                  </div>
                                                ))}
                                                <Button
                                                  size='small'
                                                  icon={<PlusOutlined />}
                                                  onClick={() =>
                                                    updatePublicationBinding(binding => ({
                                                      ...binding,
                                                      measures: [
                                                        ...binding.measures,
                                                        {
                                                          source_field: selectedPublicationFieldOptions[0]?.value || '',
                                                          output_field: selectedOutputFieldOptions[0]?.value || '',
                                                          aggregation: 'sum',
                                                        },
                                                      ],
                                                    }))
                                                  }
                                                >
                                                  {tr('添加指标聚合', 'Add metric aggregation')}
                                                </Button>
                                              </div>
                                            </div>
                                          )}
                                          <div className='space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-surface)] p-2'>
                                            <div className='text-xs text-[var(--app-muted)]'>
                                              {tr('最终输出字段：', 'Final output fields: ')}
                                              {selectedWidget.publication.output_columns.join(', ') || tr('未配置', 'Not configured')}
                                            </div>
                                            <Space.Compact block>
                                              <Select
                                                allowClear
                                                showSearch
                                                optionFilterProp='label'
                                                className='flex-1'
                                                placeholder={tr('发布结果排序字段（可选）', 'Publication sort field (optional)')}
                                                value={selectedWidget.publication.sort[0]?.field || undefined}
                                                options={selectedOutputFieldOptions}
                                                onChange={field =>
                                                  updatePublicationBinding(binding => ({
                                                    ...binding,
                                                    sort: field
                                                      ? [
                                                          {
                                                            field,
                                                            direction:
                                                              binding.sort[0]?.direction === 'descending'
                                                                ? 'descending'
                                                                : 'ascending',
                                                          },
                                                        ]
                                                      : [],
                                                  }))
                                                }
                                              />
                                              <Select
                                                className='w-24'
                                                disabled={!selectedWidget.publication.sort[0]?.field}
                                                value={selectedWidget.publication.sort[0]?.direction || 'ascending'}
                                                options={[
                                                  { value: 'ascending', label: tr('升序', 'Ascending') },
                                                  { value: 'descending', label: tr('降序', 'Descending') },
                                                ]}
                                                onChange={direction =>
                                                  updatePublicationBinding(binding => ({
                                                    ...binding,
                                                    sort: binding.sort[0] ? [{ ...binding.sort[0], direction }] : [],
                                                  }))
                                                }
                                              />
                                            </Space.Compact>
                                            <label className='block text-xs text-[var(--app-muted)]'>
                                              {tr('分享页最多输出行数', 'Maximum rows on share page')}
                                              <InputNumber
                                                className='mt-1 w-full'
                                                min={1}
                                                max={1000}
                                                value={selectedWidget.publication.max_output_rows}
                                                onChange={value =>
                                                  updatePublicationBinding(binding => ({
                                                    ...binding,
                                                    max_output_rows: Math.max(1, Math.min(1000, Number(value) || 1)),
                                                  }))
                                                }
                                              />
                                            </label>
                                          </div>
                                          <Button danger size='small' onClick={removePublicationBinding}>
                                            {tr('删除发布筛选绑定', 'Delete publication filter binding')}
                                          </Button>
                                        </>
                                      )}
                                    </div>
                                  </details>
                                </>
                              )}
                            </div>
                          </div>
                        </details>
                      </>
                    )}
                    {widgetSettingsMode === 'visual' && (
                      <>
                        {selectedWidget.type === 'kpi' && (
                          <Space.Compact block>
                            <label className='block flex-1 text-xs text-[var(--app-muted)]'>
                              {tr('前缀', 'Prefix')}
                              <Input
                                value={String(selectedWidget.style.prefix ?? '')}
                                onChange={event => updateStyle('prefix', event.target.value)}
                              />
                            </label>
                            <label className='block flex-1 text-xs text-[var(--app-muted)]'>
                              {tr('后缀', 'Suffix')}
                              <Input
                                value={String(selectedWidget.style.suffix ?? '')}
                                onChange={event => updateStyle('suffix', event.target.value)}
                              />
                            </label>
                          </Space.Compact>
                        )}
                        {selectedWidget.type === 'pie' && (
                          <label className='block text-xs text-[var(--app-muted)]'>
                            {tr('圆环内径（0–0.9）', 'Donut inner radius (0–0.9)')}
                            <Input
                              type='number'
                              min={0}
                              max={0.9}
                              step={0.05}
                              value={Number(selectedWidget.style.innerRadius ?? 0.6)}
                              onChange={event => updateStyle('innerRadius', Number(event.target.value))}
                            />
                          </label>
                        )}
                        {selectedWidget.type === 'table' && (
                          <label className='block text-xs text-[var(--app-muted)]'>
                            {tr('每页行数', 'Rows per page')}
                            <Input
                              type='number'
                              min={1}
                              max={500}
                              value={Number(selectedWidget.style.pageSize ?? 20)}
                              onChange={event => updateStyle('pageSize', Number(event.target.value))}
                            />
                          </label>
                        )}
                      </>
                    )}
                    {widgetSettingsMode === 'query' && (
                      <>
                        {snapshot?.widgets[selectedWidget.id]?.error && (
                          <Alert type='error' showIcon message={snapshot.widgets[selectedWidget.id].error?.message} />
                        )}
                        <Button
                          block
                          icon={<EyeOutlined />}
                          loading={loadingWidgetIds.has(selectedWidget.id)}
                          onClick={() => handlePreview(selectedWidget.id)}
                        >
                          {tr('校验并试运行', 'Validate and test')}
                        </Button>
                      </>
                    )}
                  </div>
                ) : selectedFilter ? (
                  <div className='space-y-4'>
                    <div className='flex items-center gap-2'>
                      <strong className='flex-1'>{tr('筛选器设置', 'Filter settings')}</strong>
                      <Tooltip title={tr('让数据助理配置这个筛选器', 'Ask the data assistant to configure this filter')}>
                        <Button
                          aria-label={tr(`让数据助理配置筛选器 ${selectedFilter.label}`, `Ask the assistant to configure ${selectedFilter.label}`)}
                          type='text'
                          icon={<CommentOutlined />}
                          onClick={event =>
                            requestAgentFilterConfiguration(selectedFilter, event.currentTarget.getBoundingClientRect())
                          }
                        />
                      </Tooltip>
                      <Button
                        danger
                        type='text'
                        icon={<DeleteOutlined />}
                        onClick={() => removeFilter(selectedFilter.id)}
                      />
                    </div>
                    <div className='rounded-lg border border-[var(--app-border)] bg-[var(--app-surface-muted)] p-3'>
                      <div className='mb-2 text-xs font-semibold text-[var(--app-text)]'>{tr('配置完整度', 'Configuration completeness')}</div>
                      <div className='flex flex-wrap gap-2'>
                        <Tag
                          style={statusTagStyle(
                            ['date_range', 'text', 'number_range'].includes(selectedFilter.type) ||
                              selectedFilter.options.length
                              ? 'success'
                              : 'warning',
                          )}
                        >
                          {selectedFilter.type === 'date_range'
                            ? tr('日期范围输入已就绪', 'Date range input ready')
                            : selectedFilter.type === 'number_range'
                              ? tr('数值范围输入已就绪', 'Number range input ready')
                              : selectedFilter.type === 'text'
                                ? tr('文本搜索输入已就绪', 'Text search input ready')
                                : tr(`${selectedFilter.options.length} 个可选值`, `${selectedFilter.options.length} options`)}
                        </Tag>
                        <Tag style={statusTagStyle(selectedFilterBoundWidgets.length ? 'success' : 'warning')}>
                          {tr(`影响 ${selectedFilterBoundWidgets.length} 个组件`, `Affects ${selectedFilterBoundWidgets.length} widgets`)}
                        </Tag>
                      </div>
                      {!selectedFilterBoundWidgets.length && (
                        <p className='mt-2 text-xs leading-5 text-[var(--app-muted)]'>
                          {tr('这个筛选器目前只会改变下拉框，不会改变图表。请在下方选择 SQL 参数并完成绑定。', 'This filter only changes the control, not the charts. Select and bind an SQL parameter below.')}
                        </p>
                      )}
                    </div>
                    <label className='block text-xs text-[var(--app-muted)]'>
                      {tr('标题', 'Title')}
                      <Input
                        value={selectedFilter.label}
                        onChange={event =>
                          replaceFilter(selectedFilter.id, filter => ({ ...filter, label: event.target.value }))
                        }
                      />
                    </label>
                    <label className='block text-xs text-[var(--app-muted)]'>
                      {tr('数据字段', 'Data field')}
                      <Input
                        value={selectedFilter.field}
                        onChange={event =>
                          replaceFilter(selectedFilter.id, filter => ({ ...filter, field: event.target.value }))
                        }
                      />
                    </label>
                    {['select', 'multi_select'].includes(selectedFilter.type) && (
                      <div
                        data-testid='dashboard-filter-field-source'
                        className='space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3'
                      >
                        <div className='text-xs font-semibold text-[var(--app-accent)]'>{tr('从当前看板数据生成可选值', 'Generate options from current dashboard data')}</div>
                        <Select
                          className='w-full'
                          showSearch
                          placeholder={tr('选择一个已返回数据的字段', 'Select a returned field')}
                          value={
                            filterFieldCandidates.some(
                              candidate =>
                                candidate.field.toLocaleLowerCase() === selectedFilter.field.toLocaleLowerCase(),
                            )
                              ? selectedFilter.field
                              : undefined
                          }
                          options={filterFieldCandidates.map(candidate => ({
                            value: candidate.field,
                            label: tr(`${candidate.label}（${candidate.options.length} 个值）`, `${candidate.label} (${candidate.options.length} values)`),
                          }))}
                          onChange={field => populateFilterFromCurrentData(selectedFilter.id, field)}
                        />
                        <Button block onClick={() => populateFilterFromCurrentData(selectedFilter.id)}>
                          {tr(`按“${selectedFilter.field}”重新读取可选值`, `Reload options for “${selectedFilter.field}”`)}
                        </Button>
                      </div>
                    )}
                    <label className='block text-xs text-[var(--app-muted)]'>
                      {tr('类型', 'Type')}
                      <Select
                        className='w-full'
                        value={selectedFilter.type}
                        options={[
                          { value: 'date_range', label: tr('日期范围', 'Date range') },
                          { value: 'select', label: tr('单选', 'Single select') },
                          { value: 'multi_select', label: tr('多选', 'Multiple select') },
                          { value: 'text', label: tr('文本搜索', 'Text search') },
                          { value: 'number_range', label: tr('数值范围', 'Number range') },
                        ]}
                        onChange={type => changeFilterType(selectedFilter.id, type)}
                      />
                    </label>
                    {selectedFilter.type === 'date_range' ? (
                      <>
                        <div className='space-y-2 rounded border border-[var(--app-border)] bg-[var(--app-accent-soft)] p-3'>
                          <div className='text-xs font-semibold text-[var(--app-accent)]'>
                            {tr('从当前看板已加载结果识别日期字段', 'Identify date fields from loaded dashboard results')}
                          </div>
                          <Select
                            aria-label={tr('日期筛选器数据字段', 'Date filter data field')}
                            className='w-full'
                            showSearch
                            placeholder={tr('选择日期字段', 'Select a date field')}
                            value={
                              dateFilterFieldCandidates.some(
                                candidate =>
                                  candidate.field.toLocaleLowerCase() === selectedFilter.field.toLocaleLowerCase(),
                              )
                                ? selectedFilter.field
                                : undefined
                            }
                            options={dateFilterFieldCandidates.map(candidate => ({
                              value: candidate.field,
                              label: candidate.dateRange
                                ? tr(
                                    `${candidate.label}（当前已加载：${candidate.dateRange[0]} 至 ${candidate.dateRange[1]}${candidate.rangeIsPartial ? '，已截断' : ''}）`,
                                    `${candidate.label} (loaded: ${candidate.dateRange[0]} to ${candidate.dateRange[1]}${candidate.rangeIsPartial ? ', truncated' : ''})`,
                                  )
                                : candidate.label,
                            }))}
                            onChange={field => selectDateFilterField(selectedFilter.id, field)}
                          />
                          <Button block onClick={() => populateDateFilterFromCurrentData(selectedFilter.id)}>
                            {tr(`采用“${selectedFilter.field}”当前已加载范围`, `Use the loaded range for “${selectedFilter.field}”`)}
                          </Button>
                          <div className='text-xs text-[var(--app-accent)]'>
                            {tr('当前范围可能受组件 SQL 的 LIMIT 影响；系统不会在新增时自动缩小你的看板数据。', 'The loaded range may be limited by widget SQL. Adding a filter does not automatically narrow dashboard data.')}
                          </div>
                          {dateFilterFieldCandidates.find(
                            candidate =>
                              candidate.field.toLocaleLowerCase() === selectedFilter.field.toLocaleLowerCase(),
                          )?.rangeIsPartial && (
                            <Alert
                              type='warning'
                              showIcon
                              message={tr('当前组件结果已截断，因此这里只能辅助识别日期字段，不会把局部日期自动设为默认范围。', 'Widget results are truncated. Date fields can be identified, but partial dates are not automatically used as defaults.')}
                            />
                          )}
                        </div>
                        <label className='block text-xs text-[var(--app-muted)]'>
                          <span className='mb-1 flex items-center justify-between gap-2'>
                            <span>{tr('相对日期', 'Relative dates')}</span>
                            <Switch
                              size='small'
                              checked={Boolean(selectedFilter.relative_date)}
                              onChange={enabled => {
                                manualFilterIdsRef.current.delete(selectedFilter.id);
                                const relativeDate = enabled
                                  ? { anchor: 'today' as const, start_offset_days: -6, end_offset_days: 0 }
                                  : null;
                                replaceFilter(selectedFilter.id, filter => ({
                                  ...filter,
                                  relative_date: relativeDate,
                                }));
                                const nextValue = enabled
                                  ? refreshDashboardFilterValues(
                                      [{ ...selectedFilter, relative_date: relativeDate }],
                                      {},
                                    )[selectedFilter.id]
                                  : selectedFilter.default;
                                setFilters(current => ({ ...current, [selectedFilter.id]: nextValue }));
                              }}
                            />
                          </span>
                          {selectedFilter.relative_date && (
                            <Space.Compact block className='mb-2'>
                              <InputNumber
                                aria-label={tr('相对日期开始偏移天数', 'Relative start offset in days')}
                                addonBefore={tr('开始 T', 'Start T')}
                                min={-3650}
                                max={3650}
                                value={selectedFilter.relative_date.start_offset_days}
                                onChange={value =>
                                  replaceFilter(selectedFilter.id, filter => ({
                                    ...filter,
                                    relative_date: filter.relative_date
                                      ? { ...filter.relative_date, start_offset_days: value ?? -6 }
                                      : null,
                                  }))
                                }
                              />
                              <InputNumber
                                aria-label={tr('相对日期结束偏移天数', 'Relative end offset in days')}
                                addonBefore={tr('结束 T', 'End T')}
                                min={-3650}
                                max={3650}
                                value={selectedFilter.relative_date.end_offset_days}
                                onChange={value =>
                                  replaceFilter(selectedFilter.id, filter => ({
                                    ...filter,
                                    relative_date: filter.relative_date
                                      ? { ...filter.relative_date, end_offset_days: value ?? 0 }
                                      : null,
                                  }))
                                }
                              />
                            </Space.Compact>
                          )}
                          {tr('默认日期范围', 'Default date range')}
                          <DatePicker.RangePicker
                            aria-label={tr('筛选器默认日期范围', 'Filter default date range')}
                            className='w-full'
                            allowClear
                            value={
                              Array.isArray(selectedFilter.default) && selectedFilter.default.length === 2
                                ? [dayjs(String(selectedFilter.default[0])), dayjs(String(selectedFilter.default[1]))]
                                : undefined
                            }
                            onChange={dates => {
                              const value = dates
                                ? [dates[0]?.format('YYYY-MM-DD'), dates[1]?.format('YYYY-MM-DD')]
                                : null;
                              replaceFilter(selectedFilter.id, filter => ({ ...filter, default: value }));
                              setFilters(current => ({ ...current, [selectedFilter.id]: value }));
                            }}
                          />
                        </label>
                        <div className='space-y-2 rounded border border-[var(--app-border)] p-3'>
                          <div className='text-xs font-semibold text-[var(--app-text)]'>{tr('让日期范围真正影响组件 SQL', 'Bind the date range to widget SQL')}</div>
                          <Space.Compact block>
                            <Input
                              aria-label={tr('日期筛选器开始参数', 'Date filter start parameter')}
                              addonBefore={tr('开始 :', 'Start :')}
                              value={
                                filterParameterDrafts[`${selectedFilter.id}:start`] ??
                                selectedDateParameterRecommendation?.startParameter ??
                                'start_date'
                              }
                              onChange={event =>
                                setFilterParameterDrafts(current => ({
                                  ...current,
                                  [`${selectedFilter.id}:start`]: event.target.value,
                                }))
                              }
                            />
                            <Input
                              aria-label={tr('日期筛选器结束参数', 'Date filter end parameter')}
                              addonBefore={tr('结束 :', 'End :')}
                              value={
                                filterParameterDrafts[`${selectedFilter.id}:end`] ??
                                selectedDateParameterRecommendation?.endParameter ??
                                'end_date'
                              }
                              onChange={event =>
                                setFilterParameterDrafts(current => ({
                                  ...current,
                                  [`${selectedFilter.id}:end`]: event.target.value,
                                }))
                              }
                            />
                          </Space.Compact>
                          <Button
                            block
                            type='primary'
                            ghost
                            onClick={() =>
                              bindDateFilterToCompatibleWidgets(
                                selectedFilter,
                                filterParameterDrafts[`${selectedFilter.id}:start`] ||
                                  selectedDateParameterRecommendation?.startParameter ||
                                  'start_date',
                                filterParameterDrafts[`${selectedFilter.id}:end`] ||
                                  selectedDateParameterRecommendation?.endParameter ||
                                  'end_date',
                              )
                            }
                          >
                            {tr('自动绑定使用这两个参数的组件', 'Bind widgets using both parameters')}
                          </Button>
                        </div>
                      </>
                    ) : selectedFilter.type === 'number_range' ? (
                      <>
                        <label className='block text-xs text-[var(--app-muted)]'>
                          {tr('默认数值范围', 'Default number range')}
                          <Space.Compact block>
                            <InputNumber
                              aria-label={tr('筛选器默认最小值', 'Filter default minimum')}
                              className='w-1/2'
                              placeholder={tr('最小值', 'Minimum')}
                              value={
                                Array.isArray(selectedFilter.default)
                                  ? ((selectedFilter.default[0] as number | null) ?? null)
                                  : null
                              }
                              onChange={minimum => {
                                const current = Array.isArray(selectedFilter.default)
                                  ? selectedFilter.default
                                  : [null, null];
                                const value = [minimum, current[1] ?? null];
                                replaceFilter(selectedFilter.id, filter => ({ ...filter, default: value }));
                                setFilters(values => ({ ...values, [selectedFilter.id]: value }));
                              }}
                            />
                            <InputNumber
                              aria-label={tr('筛选器默认最大值', 'Filter default maximum')}
                              className='w-1/2'
                              placeholder={tr('最大值', 'Maximum')}
                              value={
                                Array.isArray(selectedFilter.default)
                                  ? ((selectedFilter.default[1] as number | null) ?? null)
                                  : null
                              }
                              onChange={maximum => {
                                const current = Array.isArray(selectedFilter.default)
                                  ? selectedFilter.default
                                  : [null, null];
                                const value = [current[0] ?? null, maximum];
                                replaceFilter(selectedFilter.id, filter => ({ ...filter, default: value }));
                                setFilters(values => ({ ...values, [selectedFilter.id]: value }));
                              }}
                            />
                          </Space.Compact>
                        </label>
                        <div className='space-y-2 rounded border border-[var(--app-border)] p-3'>
                          <div className='text-xs font-semibold text-[var(--app-text)]'>{tr('让数值范围真正影响组件 SQL', 'Bind the number range to widget SQL')}</div>
                          <Space.Compact block>
                            <Input
                              aria-label={tr('数值筛选器最小值参数', 'Number filter minimum parameter')}
                              addonBefore={tr('最小 :', 'Min :')}
                              value={filterParameterDrafts[`${selectedFilter.id}:start`] ?? 'min_value'}
                              onChange={event =>
                                setFilterParameterDrafts(current => ({
                                  ...current,
                                  [`${selectedFilter.id}:start`]: event.target.value,
                                }))
                              }
                            />
                            <Input
                              aria-label={tr('数值筛选器最大值参数', 'Number filter maximum parameter')}
                              addonBefore={tr('最大 :', 'Max :')}
                              value={filterParameterDrafts[`${selectedFilter.id}:end`] ?? 'max_value'}
                              onChange={event =>
                                setFilterParameterDrafts(current => ({
                                  ...current,
                                  [`${selectedFilter.id}:end`]: event.target.value,
                                }))
                              }
                            />
                          </Space.Compact>
                          <Button
                            block
                            type='primary'
                            ghost
                            onClick={() =>
                              bindDateFilterToCompatibleWidgets(
                                selectedFilter,
                                filterParameterDrafts[`${selectedFilter.id}:start`] || 'min_value',
                                filterParameterDrafts[`${selectedFilter.id}:end`] || 'max_value',
                                '数值范围',
                              )
                            }
                          >
                            {tr('自动绑定使用这两个参数的组件', 'Bind widgets using both parameters')}
                          </Button>
                        </div>
                      </>
                    ) : (
                      <>
                        {selectedFilter.type === 'text' ? (
                          <label className='block text-xs text-[var(--app-muted)]'>
                            {tr('默认搜索内容', 'Default search')}
                            <Input
                              aria-label={tr('筛选器默认搜索内容', 'Filter default search')}
                              allowClear
                              placeholder={tr('例如：北京、iPhone', 'For example: London, iPhone')}
                              value={typeof selectedFilter.default === 'string' ? selectedFilter.default : ''}
                              onChange={event => {
                                const value = event.target.value;
                                replaceFilter(selectedFilter.id, filter => ({ ...filter, default: value }));
                                setFilters(current => ({ ...current, [selectedFilter.id]: value }));
                              }}
                            />
                          </label>
                        ) : (
                          <>
                            <label className='block text-xs text-[var(--app-muted)]'>
                              {tr('可选值（可直接输入并按回车）', 'Options (type and press Enter)')}
                              <Select
                                aria-label={tr('筛选器可选值', 'Filter options')}
                                data-testid='dashboard-filter-options'
                                className='w-full'
                                mode='tags'
                                tokenSeparators={[',', '，']}
                                placeholder={tr('例如 Store 1、Store 2', 'For example: Store 1, Store 2')}
                                value={selectedFilter.options.map(option => option.value as string | number)}
                                options={selectedFilter.options.map(option => ({
                                  label: option.label,
                                  value: option.value as string | number,
                                }))}
                                onChange={(values: Array<string | number>) =>
                                  replaceFilter(selectedFilter.id, filter => ({
                                    ...filter,
                                    options: values.map(value => ({ label: String(value), value })),
                                  }))
                                }
                              />
                            </label>
                            <label className='block text-xs text-[var(--app-muted)]'>
                              {tr('默认选择', 'Default selection')}
                              <Select
                                aria-label={tr('筛选器默认选择', 'Filter default selection')}
                                data-testid='dashboard-filter-default'
                                className='w-full'
                                allowClear
                                mode={selectedFilter.type === 'multi_select' ? 'multiple' : undefined}
                                value={selectedFilter.default as string | number | Array<string | number> | undefined}
                                options={selectedFilter.options.map(option => ({
                                  label: option.label,
                                  value: option.value as string | number,
                                }))}
                                onChange={value => {
                                  replaceFilter(selectedFilter.id, filter => ({ ...filter, default: value ?? null }));
                                  setFilters(current => ({ ...current, [selectedFilter.id]: value ?? null }));
                                }}
                              />
                            </label>
                          </>
                        )}
                        <div className='space-y-2 rounded border border-[var(--app-border)] p-3'>
                          <div className='text-xs font-semibold text-[var(--app-text)]'>{tr('让筛选器真正影响组件 SQL', 'Bind the filter to widget SQL')}</div>
                          <Input
                            aria-label={tr('筛选器 SQL 参数', 'Filter SQL parameter')}
                            data-testid='dashboard-filter-sql-parameter'
                            addonBefore=':'
                            list={`dashboard-filter-parameters-${selectedFilter.id}`}
                            value={
                              filterParameterDrafts[selectedFilter.id] ??
                              recommendDashboardFilterParameter(
                                selectedFilter.id,
                                selectedFilter.field,
                                filterParameterCandidates,
                              ) ??
                              normalizeDashboardFilterParameter(
                                selectedFilter.field,
                                normalizeDashboardFilterParameter(selectedFilter.id),
                              )
                            }
                            onChange={event =>
                              setFilterParameterDrafts(current => ({
                                ...current,
                                [selectedFilter.id]: event.target.value,
                              }))
                            }
                          />
                          <datalist id={`dashboard-filter-parameters-${selectedFilter.id}`}>
                            {filterParameterCandidates.map(parameter => (
                              <option key={parameter} value={parameter} />
                            ))}
                          </datalist>
                          <Button
                            block
                            type='primary'
                            ghost
                            onClick={() =>
                              bindFilterToCompatibleWidgets(
                                selectedFilter,
                                filterParameterDrafts[selectedFilter.id] ||
                                  recommendDashboardFilterParameter(
                                    selectedFilter.id,
                                    selectedFilter.field,
                                    filterParameterCandidates,
                                  ) ||
                                  selectedFilter.field,
                              )
                            }
                          >
                            {tr('自动绑定使用该参数的组件', 'Bind widgets using this parameter')}
                          </Button>
                        </div>
                      </>
                    )}
                    <Alert
                      type='info'
                      showIcon
                      message={
                        selectedFilter.type === 'multi_select'
                          ? tr('多选允许同时选择多个值；空列表表示不过滤。组件 SQL 应使用 IN (:参数名)，不要使用等号。', 'Multiple selections allow several values; an empty list means no filter. Widget SQL should use IN (:parameter), not equality.')
                          : selectedFilter.type === 'number_range'
                            ? tr('数值范围使用最小值、最大值两个参数；任一端留空表示不限制该方向。', 'Number ranges use minimum and maximum parameters; a blank endpoint is unbounded.')
                            : selectedFilter.type === 'text'
                              ? tr('文本搜索会把关键词作为绑定参数传给组件 SQL；建议在 SQL 中使用数据库支持的包含匹配。', 'Text search passes the keyword as a bound SQL parameter; use a database-supported contains match.')
                              : selectedFilter.type === 'date_range'
                                ? tr('日期范围需要开始、结束两个参数；清空日期时表示不限制时间。', 'Date ranges require start and end parameters; clearing them removes the time limit.')
                                : tr('单选筛选器需要可选值和一个 SQL 参数绑定。', 'Single-select filters require options and one SQL parameter binding.')
                      }
                    />
                  </div>
                ) : (
                  <div className='mt-20 text-center text-sm text-[var(--app-muted)]'>{tr('选择一个组件后在这里编辑', 'Select a widget to edit it here')}</div>
                )}
              </div>
            </aside>
          ) : workspaceMode === 'edit' ? (
            <div className={`${styles.collapsedRail} ${styles.collapsedRailRight}`}>
              <Tooltip title={tr('展开属性设置', 'Expand properties')} placement='left'>
                <Button
                  aria-label={tr('展开属性设置', 'Expand properties')}
                  type='text'
                  size='small'
                  icon={<SettingOutlined />}
                  onClick={() => setSettingsCollapsed(false)}
                />
              </Tooltip>
            </div>
          ) : null}
        </div>
        {LAYOUT_TEMPLATES_ENABLED && layoutPickerOpen && (
          <DashboardLayoutTemplatePicker
            schema={schema}
            snapshot={snapshot}
            onClose={() => setLayoutPickerOpen(false)}
            onApply={(id, withAppearance) => {
              setSchema(current => applyDashboardLayoutTemplate(current, id, withAppearance));
              setLayoutPickerOpen(false);
              setLibraryCollapsed(true);
              setSettingsCollapsed(true);
              message.success(tr(`已应用${getDashboardLayoutTemplate(id)?.title}布局，可撤销`, 'Layout applied; this can be undone.'));
            }}
          />
        )}
        {workspaceMode === 'edit' && (
          <DashboardAnnotationTray
            themeStyle={interfaceThemeVariables(editorTheme)}
            saved={assistantSession.saved}
            draftCount={annotationAttachments.length}
            open={annotationTrayOpen}
            running={assistantRunning}
            onOpenChange={setAnnotationTrayOpen}
            onEdit={editAnnotationDraft}
            onRemove={removeAnnotationDraft}
            onSend={() => void sendAssistantMessage('', annotationAttachments)}
          />
        )}
        <DashboardAnnotationOverlay
          themeStyle={interfaceThemeVariables(editorTheme)}
          key={
            annotationSelection
              ? `${annotationSelection.draftId || ''}:${annotationSelection.target.widget_id || annotationSelection.target.filter_id}:${annotationSelection.target.kind}:${annotationSelection.target.label}:${Boolean(annotationSelection.suggestedPrompt)}`
              : 'closed'
          }
          selection={annotationSelection}
          annotations={annotations}
          creating={assistantRunning}
          applyingId={applyingAnnotationId}
          onTargetChange={target => setAnnotationSelection(current => (current ? { ...current, target } : current))}
          onCreate={handleCreateAnnotation}
          onApply={handleApplyAnnotation}
          onReject={handleRejectAnnotation}
          onClose={() => setAnnotationSelection(null)}
        />
        {schedulePanelOpen && (
          <SaveAsScheduledTaskDrawer
            open
            onClose={() => setSchedulePanelOpen(false)}
            defaultName={`${schema.dashboard.title} · 定时任务`}
            dashboard={{
              title: schema.dashboard.title,
              dashboard_id: record.id,
              filters: scheduleDashboardFilterValues(schema.filters, filters),
            }}
            beforeCreate={async () => {
              if (!validateInBrowser()) throw new Error(tr('请先修正看板配置，再创建定时任务。', 'Correct the dashboard configuration before creating a schedule.'));
              await persistDraft();
            }}
          />
        )}
        <DashboardArtifactPanel
          dashboardId={record.id}
          open={artifactPanelOpen}
          onClose={() => setArtifactPanelOpen(false)}
        />
        <DashboardAccessPanel
          dashboardId={record.id}
          open={accessPanelOpen}
          onClose={() => setAccessPanelOpen(false)}
        />
        {publishPanelOpen && (
          <DashboardPublishDialog
            dashboardId={record.id}
            busy={publishing}
            onPublish={handlePublish}
            onClose={() => setPublishPanelOpen(false)}
          />
        )}
        <DashboardLifecyclePanel
          themeStyle={interfaceThemeVariables(editorTheme)}
          dashboardId={record.id}
          currentRevision={record.current_revision}
          open={lifecyclePanelOpen}
          onClose={() => setLifecyclePanelOpen(false)}
          onOpenPublish={() => {
            setLifecyclePanelOpen(false);
            setPublishPanelOpen(true);
          }}
          onRecordChange={next => {
            if (!setRecord(next)) return;
            resetSchema(next.schema);
            clearDashboardLocalDraft(next.id);
          }}
        />
      </div>
    </ConfigProvider>
  );
}
