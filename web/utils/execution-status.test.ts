import { describe, expect, it } from 'vitest';
import { executionStatus, interruptedAnswer, settleTaskPlan, settleExecutionSteps, recordedExecutionSteps, readExecutionSummary, summarizeExecution, executionDurationText } from './execution-status';

describe('execution completion status', () => {
  it('uses identical visible-step counts for live and deduplicated history', () => {
    const steps = [
      { id: 'todo', action: 'todowrite', status: 'done' },
      { id: 'sql-error', action: 'sql_query', status: 'failed' },
      { id: 'todo', action: 'todowrite', status: 'done' },
      { id: 'sql', action: 'sql_query', status: 'done' },
      { id: 'progress', action: '__progress__', status: 'done' },
      { id: 'final', action: 'terminate', status: 'done' },
    ];
    expect(summarizeExecution(steps)).toEqual(summarizeExecution(recordedExecutionSteps(steps)));
    expect(summarizeExecution(steps)).toEqual({ version: 1, recorded_steps: 3, tool_steps: 3 });
  });

  it('keeps the final server measurement through JSON reload and elapsed wall time', () => {
    const final = { version: 1 as const, recorded_steps: 6, tool_steps: 5, duration_ms: 119999, duration_complete: true };
    const reloaded = readExecutionSummary(JSON.parse(JSON.stringify(final)));
    expect(summarizeExecution([], final)).toEqual(summarizeExecution([], reloaded));
    expect(executionDurationText(final)).toBe('1m 59s');
    expect(executionDurationText(reloaded)).toBe('1m 59s');
    expect(executionDurationText({ ...final, duration_ms: 120000 })).toBe('2m 0s');
    expect(executionDurationText({ ...final, duration_ms: 0 })).toBe('0s');
  });

  it('does not invent missing historical duration or label a checkpoint as complete timing', () => {
    expect(executionDurationText(undefined)).toBe('');
    expect(executionDurationText({ version: 1, recorded_steps: 1, tool_steps: 1, duration_ms: 5000, duration_complete: false })).toBe('');
    expect(readExecutionSummary({ version: 1, recorded_steps: 1, tool_steps: 2 })).toBeUndefined();
    expect(readExecutionSummary({ version: 1, recorded_steps: 1, tool_steps: 1, duration_ms: NaN })).toEqual({ version: 1, recorded_steps: 1, tool_steps: 1 });
    expect(summarizeExecution([{ id: 'batch', action: 'parallel_tool', status: 'done' }]).tool_steps).toBe(1);
  });
  it('does not turn an interrupted or failed final event into successful running tools', () => {
    const steps = [{ action: 'code', status: 'running' }, { action: 'sql', status: 'failed' }];
    expect(settleExecutionSteps(steps, 'interrupted').map(step => step.status)).toEqual(['failed', 'failed']);
    expect(settleExecutionSteps(steps, 'failed').map(step => step.status)).toEqual(['failed', 'failed']);
    expect(settleExecutionSteps(steps, 'completed').map(step => step.status)).toEqual(['done', 'failed']);
  });
  it('replays one current version per step id without duplicating persisted todo updates', () => {
    expect(recordedExecutionSteps([
      { id: 'todo', status: 'running' }, { id: 'sql', status: 'done' }, { id: 'todo', status: 'done' },
    ])).toEqual([{ id: 'todo', status: 'done' }, { id: 'sql', status: 'done' }]);
  });
  it('retains partial Markdown on disconnect and settles active tasks without claiming completion', () => {
    const partial = '## Partial\n\n```sql\nSELECT 1;\n```';
    expect(interruptedAnswer(partial, 'vi')).toContain(partial);
    expect(interruptedAnswer('', 'vi')).toContain('Kết nối đã bị gián đoạn');
    const tasks = [{ status: 'completed' }, { status: 'in_progress' }, { status: 'pending' }];
    expect(settleTaskPlan(tasks, 'interrupted')?.map(t => t.status)).toEqual(['completed', 'cancelled', 'pending']);
    expect(settleTaskPlan(tasks, 'completed')).toBe(tasks);
  });
  const done = { action: 'prepare_financial_report', status: 'done' };
  const failed = { action: 'review_financial_report', status: 'failed' };

  it('does not show success after a failed review, even with saved output', () => {
    expect(executionStatus([done, failed], false)).toBe('partial');
    expect(executionStatus([failed], false)).toBe('failed');
  });

  it('honors interrupted and failed history when the saved tools all succeeded', () => {
    expect(executionStatus([done], false, [], 'failed')).toBe('failed');
    expect(executionStatus([done], false, [], 'interrupted')).toBe('incomplete');
  });

  it('does not treat uncompleted planned stages as success', () => {
    expect(executionStatus([done], false, [{ status: 'error' }])).toBe('partial');
    expect(executionStatus([done], false, [{ status: 'pending' }])).toBe('incomplete');
    expect(executionStatus([done], false, [{ status: 'cancelled' }])).toBe('incomplete');
  });

  it('keeps running during retries and completes a successful execution', () => {
    expect(executionStatus([done, failed], true)).toBe('running');
    expect(executionStatus([{ status: 'running' }])).toBe('running');
    expect(executionStatus([done], false, [{ status: 'completed' }])).toBe('done');
  });

  it('reports a recovered tool without hiding unrelated failed stages', () => {
    const sqlError = { action: 'sql_query', status: 'failed' };
    const sqlSuccess = { action: 'sql_query', status: 'done' };
    expect(executionStatus([sqlError, sqlSuccess], false, [], 'completed')).toBe('recovered');
    expect(executionStatus([sqlSuccess, sqlError], false, [], 'completed')).toBe('partial');
    expect(executionStatus([failed, sqlSuccess], false, [], 'completed')).toBe('partial');
    expect(executionStatus([sqlError, sqlSuccess], false, [{ status: 'error' }], 'completed')).toBe('partial');
    expect(executionStatus([sqlError, sqlSuccess], false, [], 'failed')).toBe('failed');
  });
});
