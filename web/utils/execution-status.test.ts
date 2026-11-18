import { describe, expect, it } from 'vitest';
import { executionStatus, interruptedAnswer, settleTaskPlan, settleExecutionSteps, recordedExecutionSteps } from './execution-status';

describe('execution completion status', () => {
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
