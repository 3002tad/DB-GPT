import { expect, it } from 'vitest';
import { skillDraft } from './skill-draft';

it('preserves questions on skill selection and deselection', () => {
  expect(skillDraft('Analyze sales', 'sql', true)).toBe('Analyze sales');
  expect(skillDraft('Analyze sales', 'sql', false)).toBe('Analyze sales');
  expect(skillDraft('/sql Analyze sales', 'sql', false)).toBe('/sql Analyze sales');
});

it('updates only empty drafts and bare skill shortcuts', () => {
  expect(skillDraft('', 'sql', true)).toBe('/sql ');
  expect(skillDraft('/old-skill ', 'sql', true)).toBe('/sql ');
  expect(skillDraft('/sql ', 'sql', false)).toBe('');
  expect(skillDraft('/other ', 'sql', false)).toBe('/other ');
});
