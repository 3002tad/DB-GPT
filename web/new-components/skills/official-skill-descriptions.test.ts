import { describe, expect, it } from 'vitest';
import { officialSkillDescription, skillDisplayDescription } from './official-skill-descriptions';

describe('official skill descriptions', () => {
  it('provides concise Vietnamese and English CSV/Excel/SQL summaries', () => {
    for (const name of ['csv-data-analyzer', 'excel-data-analyzer', 'sql-data-analysis']) {
      expect(officialSkillDescription(name, 'vi', '[TODO]')).not.toContain('TODO');
      expect(officialSkillDescription(name, 'en', '[TODO]')).not.toContain('TODO');
      expect(officialSkillDescription(name, 'vi', '[TODO]')).not.toBe(
        officialSkillDescription(name, 'en', '[TODO]'),
      );
    }
  });

  it('preserves personal descriptions rather than replacing them by name', () => {
    expect(skillDisplayDescription({
      name: 'csv-data-analyzer', type: 'personal', description: 'My CSV workflow',
    }, 'vi')).toBe('My CSV workflow');
  });
});
