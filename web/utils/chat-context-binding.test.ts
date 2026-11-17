import { describe, expect, it } from 'vitest';
import { missingContextSelections } from './chat-context-binding';

describe('explicit chat context selection', () => {
  it('identifies typed labels without granting them binding authority', () => {
    expect(missingContextSelections('[Database: demo] [Knowledge: guide] Analyze')).toEqual(['database', 'knowledge']);
    expect(missingContextSelections('[Database: demo] [Knowledge: guide] Analyze', 'demo')).toEqual(['knowledge']);
    expect(missingContextSelections('[Database: demo] [Knowledge: guide] Analyze', 'demo', 'guide')).toEqual([]);
  });
  it('preserves general chat, file questions and discussion of labels', () => {
    for (const input of ['Hello', 'Analyze the attached CSV', 'Explain [Database: demo] labels', 'Write SQL for a hypothetical table']) {
      expect(missingContextSelections(input)).toEqual([]);
    }
  });
  it('handles casing and ignores labels outside the leading context block', () => {
    expect(missingContextSelections(' [database: demo]\nQuestion')).toEqual(['database']);
    expect(missingContextSelections('[Database: demo] Explain [Knowledge: sample]', 'demo')).toEqual([]);
  });
});
