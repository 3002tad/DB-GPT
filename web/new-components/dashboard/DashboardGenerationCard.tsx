import { useUiText } from '@/hooks/use-ui-text';
import { AppstoreOutlined, CheckCircleFilled, LoadingOutlined, WarningOutlined } from '@ant-design/icons';
import { Button, Progress, Tag } from 'antd';
import { getDashboardLayoutTemplate } from './dashboard-layout-templates';
import { LAYOUT_TEMPLATES_ENABLED } from './dashboard-release-features';

export type DashboardGenerationStatus = 'planning' | 'awaiting_confirmation' | 'generating' | 'created' | 'failed';
export type DashboardWidgetGenerationStatus = 'running' | 'validated' | 'failed';

export interface DashboardPlanSummary {
  business_theme?: string;
  audience?: string;
  decision_goal?: string;
  analysis_logic?: string[];
  layout_rationale?: string;
  layout_template?: string | null;
  filter_strategy?: string;
  metrics?: string[];
  dimensions?: string[];
  filters?: Array<{ id: string; label?: string; type?: string }>;
  widgets?: Array<{
    id: string;
    title: string;
    type: string;
    metric?: string;
    dimensions?: string[];
    analysis_level?: number;
    rationale?: string;
    layout?: { width?: string; height?: string } | null;
  }>;
}

export interface DashboardGenerationState {
  status: DashboardGenerationStatus;
  title: string;
  activeWidgetTitle?: string;
  totalWidgets: number;
  validatedWidgets: number;
  failedWidgets: number;
  widgetStates: Record<string, DashboardWidgetGenerationStatus>;
  dashboardId?: string;
  sourceTurnId?: string;
  assetState?: 'generated' | 'saved';
  editorPath?: string;
  dataSourceId?: string;
  currentRevision?: number;
  confirmationPrompt?: string;
  errorMessage?: string;
  revisionPrompt?: string;
  plan?: DashboardPlanSummary;
  generationId?: string;
  limitSeconds?: number;
  stageLabel?: string;
  validatedWidgetIds?: string[];
  pendingWidgetIds?: string[];
  savedWidgetIds?: string[];
  savedRevision?: number;
  retryHint?: string;
}

interface DashboardGenerationCardProps {
  state: DashboardGenerationState;
  onOpen: () => void;
  onConfirm?: (state: DashboardGenerationState) => void;
  onRevise?: () => void;
  busy?: boolean;
}

const DashboardGenerationCard = ({
  state,
  onOpen,
  onConfirm,
  onRevise,
  busy = false,
}: DashboardGenerationCardProps) => {
  const tr = useUiText();
  const completed = state.validatedWidgets + state.failedWidgets;
  const percent = state.totalWidgets > 0 ? Math.round((completed / state.totalWidgets) * 100) : 0;
  const created = state.status === 'created';
  const failed = state.status === 'failed';
  const awaitingConfirmation = state.status === 'awaiting_confirmation';
  const orderedWidgets = [...(state.plan?.widgets || [])].sort(
    (left, right) => (left.analysis_level || 3) - (right.analysis_level || 3),
  );
  const widgetTitles = (ids: string[]) =>
    ids.map(id => state.plan?.widgets?.find(widget => widget.id === id)?.title || id).join('、') || tr('无', 'None');

  return (
    <div className='mt-3 rounded-xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm dark:border-blue-900/50 dark:from-blue-950/30 dark:to-[#1a1b1e]'>
      <div className='flex items-start justify-between gap-3'>
        <div className='flex min-w-0 items-start gap-3'>
          <div className='flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-blue-600 text-white'>
            <AppstoreOutlined />
          </div>
          <div className='min-w-0'>
            <div className='truncate text-sm font-semibold text-gray-900 dark:text-gray-100'>{state.title}</div>
            <div className='mt-1 text-xs text-gray-500 dark:text-gray-400'>
              {failed
                ? state.errorMessage || tr('本次生成未完成，已保存的规划或草稿仍保留。', 'Generation did not finish. Saved plans and drafts are retained.')
                : created
                  ? state.assetState === 'saved'
                    ? tr('看板已保存，可在当前任务中继续编辑', 'Dashboard saved. Continue editing in this task.')
                    : tr('可恢复的看板草稿已生成，保存后进入资产库', 'A recoverable dashboard draft is ready; save it to add it to the library.')
                  : awaitingConfirmation
                    ? tr('SQL 尚未生成，请先确认指标、维度、筛选器和图表计划', 'SQL has not been generated. Confirm metrics, dimensions, filters and chart plan first.')
                    : state.status === 'planning'
                      ? tr('正在校验指标、维度和筛选器', 'Validating metrics, dimensions and filters')
                      : state.activeWidgetTitle
                        ? tr(`正在校验：${state.activeWidgetTitle}`, `Validating: ${state.activeWidgetTitle}`)
                        : tr('正在生成并试运行组件查询', 'Generating and testing widget queries')}
            </div>
          </div>
        </div>
        {created ? (
          <CheckCircleFilled className='mt-1 text-lg text-emerald-500' />
        ) : awaitingConfirmation || failed ? (
          <WarningOutlined className='mt-1 text-lg text-amber-500' />
        ) : (
          <LoadingOutlined spin className='mt-1 text-lg text-blue-500' />
        )}
      </div>

      {state.status === 'generating' && state.limitSeconds && (
        <div className='mt-2 text-xs text-gray-500'>
          {tr(`本轮生成最多 ${state.limitSeconds} 秒，超时将停止并保留规划，不会自动重试。`, `Generation stops after ${state.limitSeconds} seconds, retains the plan and does not retry automatically.`)}
        </div>
      )}

      {failed && (
        <div
          role='alert'
          aria-label={tr('看板生成未完成', 'Dashboard generation incomplete')}
          className='mt-3 space-y-2 break-words text-xs text-gray-600 dark:text-gray-300'
        >
          {state.stageLabel && <div>{tr('停在：', 'Stopped at: ')}{state.stageLabel}</div>}
          {state.validatedWidgetIds && (
            <div>{tr('SQL 试运行通过（不等于已保存）：', 'SQL test passed (not necessarily saved): ')}{widgetTitles(state.validatedWidgetIds)}</div>
          )}
          {state.pendingWidgetIds && <div>{tr('尚未通过试运行：', 'SQL test pending: ')}{widgetTitles(state.pendingWidgetIds)}</div>}
          {state.savedRevision ? (
            <div>
              {tr(`保留的草稿修订 ${state.savedRevision}；已保存的可用组件：`, `Retained draft revision ${state.savedRevision}; saved widgets: `)}{widgetTitles(state.savedWidgetIds || [])}
            </div>
          ) : (
            state.generationId && <div>{tr('本轮未保存可用组件；候选 SQL 只在本轮内存中暂存。', 'No usable widgets were saved; candidate SQL is held only in memory for this run.')}</div>
          )}
          {state.retryHint && <div>{state.retryHint}</div>}
          <div className='flex flex-wrap gap-2'>
            {state.editorPath && (
              <Button size='small' onClick={onOpen} disabled={busy}>
                {tr('查看保留的规划/草稿', 'View retained plan or draft')}
              </Button>
            )}
            {state.revisionPrompt && onRevise && (
              <Button size='small' onClick={onRevise} disabled={busy}>
                {tr('修改计划后重试', 'Revise plan and retry')}
              </Button>
            )}
          </div>
        </div>
      )}

      {state.totalWidgets > 0 && (
        <div className='mt-3'>
          {!awaitingConfirmation && !failed && (
            <Progress percent={created ? 100 : percent} size='small' showInfo={false} />
          )}
          <div className='mt-1 flex flex-wrap items-center gap-2 text-xs text-gray-500'>
            <span>
              {awaitingConfirmation
                ? tr(`计划包含 ${state.totalWidgets} 个组件`, `Plan contains ${state.totalWidgets} widgets`)
                : tr(`已校验 ${state.validatedWidgets}/${state.totalWidgets}`, `Validated ${state.validatedWidgets}/${state.totalWidgets}`)}
            </span>
            {state.failedWidgets > 0 && (
              <Tag color='warning' className='m-0'>
                <WarningOutlined className='mr-1' />
                {tr(`${state.failedWidgets} 个组件待修正`, `${state.failedWidgets} widgets need correction`)}
              </Tag>
            )}
          </div>
        </div>
      )}

      {awaitingConfirmation && state.plan && (
        <div className='mt-3 rounded-lg border border-amber-100 bg-amber-50/70 p-3 text-xs text-gray-700 dark:border-amber-900/50 dark:bg-amber-950/20 dark:text-gray-200'>
          {state.plan.business_theme && <div className='font-medium'>{state.plan.business_theme}</div>}
          {LAYOUT_TEMPLATES_ENABLED && getDashboardLayoutTemplate(state.plan.layout_template) && (
            <div className='mt-2'>{tr('布局模板：', 'Layout template: ')}{getDashboardLayoutTemplate(state.plan.layout_template)?.title}</div>
          )}
          {state.dataSourceId && <div className='mt-1 text-gray-500'>{tr('数据源：', 'Data source: ')}{state.dataSourceId}</div>}
          {(state.plan.audience || state.plan.decision_goal) && (
            <div className='mt-2 grid gap-1 rounded-md bg-white/70 p-2 dark:bg-black/20'>
              {state.plan.audience && (
                <div>
                  <span className='text-gray-500'>{tr('受众：', 'Audience: ')}</span>
                  {state.plan.audience}
                </div>
              )}
              {state.plan.decision_goal && (
                <div>
                  <span className='text-gray-500'>{tr('决策目标：', 'Decision goal: ')}</span>
                  {state.plan.decision_goal}
                </div>
              )}
            </div>
          )}
          {(state.plan.analysis_logic || []).length > 0 && (
            <div className='mt-2'>
              <div className='text-gray-500'>{tr('分析逻辑', 'Analysis logic')}</div>
              <ol className='mb-0 mt-1 list-decimal space-y-1 pl-5'>
                {state.plan.analysis_logic?.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}
              </ol>
            </div>
          )}
          {(state.plan.metrics || []).length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1'>
              <span className='mr-1 text-gray-500'>{tr('指标', 'Metrics')}</span>
              {state.plan.metrics?.map(metric => (
                <Tag key={metric} color='blue' className='m-0'>
                  {metric}
                </Tag>
              ))}
            </div>
          )}
          {(state.plan.dimensions || []).length > 0 && (
            <div className='mt-2 flex flex-wrap gap-1'>
              <span className='mr-1 text-gray-500'>{tr('维度', 'Dimensions')}</span>
              {state.plan.dimensions?.map(dimension => (
                <Tag key={dimension} className='m-0'>
                  {dimension}
                </Tag>
              ))}
            </div>
          )}
          {orderedWidgets.length > 0 && (
            <ul className='mb-0 mt-2 list-disc space-y-1 pl-5'>
              {orderedWidgets.map(widget => (
                <li key={widget.id}>
                  L{widget.analysis_level || 3} · {widget.title}（{widget.type}）
                  {widget.rationale && <span className='text-gray-500'> — {widget.rationale}</span>}
                </li>
              ))}
            </ul>
          )}
          {(state.plan.layout_rationale || state.plan.filter_strategy) && (
            <div className='mt-2 space-y-1 text-gray-500'>
              {state.plan.layout_rationale && <div>{tr('布局理由：', 'Layout rationale: ')}{state.plan.layout_rationale}</div>}
              {state.plan.filter_strategy && <div>{tr('筛选策略：', 'Filter strategy: ')}{state.plan.filter_strategy}</div>}
            </div>
          )}
          <div className='mt-3 flex flex-wrap gap-2'>
            <Button
              type='primary'
              size='small'
              onClick={() => onConfirm?.(state)}
              disabled={!onConfirm || busy}
              loading={busy}
            >
              {tr('确认并生成 SQL', 'Confirm and generate SQL')}
            </Button>
            <Button size='small' onClick={onRevise} disabled={!onRevise || busy}>
              {tr('修改计划', 'Revise plan')}
            </Button>
          </div>
        </div>
      )}

      {created && state.editorPath && (
        <Button type='primary' className='mt-3' onClick={onOpen}>
          {state.assetState === 'saved' ? tr('继续编辑', 'Continue editing') : tr('查看看板', 'View dashboard')}
        </Button>
      )}
    </div>
  );
};

export default DashboardGenerationCard;
