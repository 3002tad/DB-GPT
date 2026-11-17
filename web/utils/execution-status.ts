type Step = { action?: string; status: string };
type Task = { status: string };

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
