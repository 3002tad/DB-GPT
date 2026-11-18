import { act, renderHook } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { findTrySkill, skillTryRoute } from '@/utils/skill-try';
import { useSkillTryEntry } from './use-skill-try-entry';

const skill = { id: 'actual-id', name: 'csv-data-analysis', type: 'official' };

describe('skill try handoff', () => {
  it('routes by registered name, not path, ID or a dashboard template parameter', () => {
    expect(skillTryRoute(skill.name)).toEqual({ pathname: '/', query: { try_skill: skill.name } });
    expect(findTrySkill(skill.name, [skill])).toBe(skill);
    expect(findTrySkill(['csv-data-analysis'], [skill])).toBeUndefined();
    expect(findTrySkill('missing', [skill])).toBeUndefined();
  });

  it('waits for the skill list and preserves an authored question', () => {
    const unavailable = vi.fn();
    const { result, rerender } = renderHook(({ skills }: { skills: typeof skill[] | undefined }) => {
      const [selected, select] = useState<typeof skill | null>(null);
      const [draft, updateDraft] = useState('Phân tích tệp đang chọn');
      useSkillTryEntry({ ready: true, requested: skill.name, skills, select, updateDraft, unavailable });
      return { selected, draft };
    }, { initialProps: { skills: undefined as typeof skill[] | undefined } });
    expect(result.current.selected).toBeNull();
    rerender({ skills: [skill] });
    expect(result.current.selected).toEqual(skill);
    expect(result.current.draft).toBe('Phân tích tệp đang chọn');
    expect(unavailable).not.toHaveBeenCalled();
  });

  it('prepares an empty composer once without reselecting after a user clears it', () => {
    const { result, rerender } = renderHook(() => {
      const [selected, select] = useState<typeof skill | null>(null);
      const [draft, updateDraft] = useState('');
      useSkillTryEntry({ ready: true, requested: skill.name, skills: [skill], select, updateDraft, unavailable: vi.fn() });
      return { selected, draft, clear: () => select(null) };
    });
    expect(result.current.selected).toEqual(skill);
    expect(result.current.draft).toBe('/csv-data-analysis ');
    act(() => result.current.clear());
    rerender();
    expect(result.current.selected).toBeNull();
  });

  it('does not select a missing skill or overwrite the draft', () => {
    const unavailable = vi.fn();
    const select = vi.fn();
    const updateDraft = vi.fn();
    renderHook(() => useSkillTryEntry({ ready: true, requested: 'unknown', skills: [skill], select, updateDraft, unavailable }));
    expect(unavailable).toHaveBeenCalledOnce();
    expect(select).not.toHaveBeenCalled();
    expect(updateDraft).not.toHaveBeenCalled();
  });
});
