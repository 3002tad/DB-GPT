type Step = { action?: string; status: string };
type Task = { status: string };

export type ExecutionSummary = {
  version: 1;
  recorded_steps: number;
  tool_steps: number;
  duration_ms?: number;
  duration_complete?: boolean;
};

export function readExecutionSummary(value: unknown): ExecutionSummary | undefined {
  const item = value as ExecutionSummary | undefined;
  if (!item || item.version !== 1 || !Number.isInteger(item.recorded_steps) || item.recorded_steps < 0
    || !Number.isInteger(item.tool_steps) || item.tool_steps < 0 || item.tool_steps > item.recorded_steps) return;
  return { version: 1, recorded_steps: item.recorded_steps, tool_steps: item.tool_steps,
    ...(typeof item.duration_ms === 'number' && Number.isFinite(item.duration_ms) && item.duration_ms >= 0
      ? { duration_ms: item.duration_ms, duration_complete: item.duration_complete === true } : {}) };
}

export function summarizeExecution(steps: (Step & { id?: string })[], summary?: ExecutionSummary) {
  const saved = readExecutionSummary(summary);
  if (saved) return saved;
  const visible = recordedExecutionSteps(steps).filter(step => !['__progress__', 'terminate'].includes((step.action || '').toLowerCase()));
  return { version: 1 as const, recorded_steps: visible.length, tool_steps: visible.filter(step => !!step.action).length };
}

export function executionDurationText(summary?: ExecutionSummary): string {
  // An interrupted/running checkpoint is a partial duration, not a final one.
  if (!summary?.duration_complete || summary.duration_ms == null) return '';
  const seconds = Math.floor(summary.duration_ms / 1000);
  return seconds >= 60 ? `${Math.floor(seconds / 60)}m ${seconds % 60}s` : `${seconds}s`;
}

export function settleExecutionSteps<T extends Step>(steps: T[], recordedStatus?: string): T[] {
  const interrupted = recordedStatus && !['done', 'completed', 'recovered'].includes(recordedStatus);
  return steps.map(step => step.status === 'running'
    ? { ...step, status: interrupted ? 'failed' : 'done' } as T : step);
}

export function recordedExecutionSteps<T extends { id?: string }>(steps: T[]): T[] {
  const result: T[] = [];
  const positions = new Map<string, number>();
  for (const step of steps) {
    if (step.id && positions.has(step.id)) result[positions.get(step.id)!] = step;
    else { if (step.id) positions.set(step.id, result.length); result.push(step); }
  }
  return result;
}

export function settleTaskPlan<T extends Task>(tasks: T[] | undefined, recordedStatus?: string): T[] | undefined {
  if (!['interrupted', 'cancelled', 'failed', 'incomplete'].includes(recordedStatus || '')) return tasks;
  return tasks?.map(task => ['in_progress', 'running'].includes(task.status)
    ? { ...task, status: 'cancelled' } as T : task);
}

export function interruptedAnswer(partial: string, language = 'en'): string {
  const notice = language.startsWith('vi')
    ? 'Kết nối đã bị gián đoạn trước khi nhận câu trả lời cuối. Tiến độ và kết quả đã lưu được giữ lại; hãy mở lại phiên để kiểm tra trước khi tiếp tục.'
    : language.startsWith('zh')
      ? '连接在最终答复前中断。已保存的进度和结果仍保留，请重新打开会话检查后继续。'
      : 'The connection ended before the final answer arrived. Saved progress and results were retained; reopen the conversation to check before continuing.';
  return partial.trim() ? `${partial.trim()}\n\n_${notice}_` : notice;
}

export type ExecutionStatus = 'running' | 'done' | 'recovered' | 'partial' | 'failed' | 'incomplete';

/** Ending the stream does not imply that its tools or planned stages succeeded. */
export function executionStatus(
  steps: Step[],
  thinking = false,
  tasks: Task[] = [],
  recordedStatus?: string,
): ExecutionStatus {
  if (thinking || (!recordedStatus && steps.some(step => step.status === 'running'))) return 'running';
  if (recordedStatus === 'failed' || recordedStatus === 'report_failed') return 'failed';
  if (recordedStatus && !['done', 'completed'].includes(recordedStatus)) return 'incomplete';
  const failed = steps.some(step => step.status === 'failed') || tasks.some(task => task.status === 'error');
  if (failed) {
    // A terminal success plus a later success of the same tool is evidence of
    // a recovered attempt, not permission to erase unrelated failed stages.
    const recovered = ['done', 'completed'].includes(recordedStatus || '') &&
      !tasks.some(task => task.status !== 'completed') &&
      steps.every((step, index) => step.status === 'done' ||
        (step.status === 'failed' && step.action && ['sql_query', 'chart_query'].includes(step.action) &&
          steps.slice(index + 1).some(next => next.action === step.action && next.status === 'done')));
    if (recovered) return 'recovered';
    const completed =
      steps.some(step => step.action !== '__progress__' && step.status === 'done') ||
      tasks.some(task => task.status === 'completed');
    return completed ? 'partial' : 'failed';
  }
  if (tasks.some(task => task.status !== 'completed') || steps.some(step => step.status !== 'done'))
    return 'incomplete';
  return 'done';
}
