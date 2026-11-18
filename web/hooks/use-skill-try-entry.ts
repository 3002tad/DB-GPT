import { skillDraft } from '@/utils/skill-draft';
import { findTrySkill } from '@/utils/skill-try';
import { useEffect, useRef } from 'react';

/** Prepare a registered skill once; never reset a conversation or send a turn. */
export function useSkillTryEntry<T extends { name: string }>({
  ready, requested, skills, select, updateDraft, unavailable,
}: {
  ready: boolean;
  requested: string | string[] | undefined;
  skills: readonly T[] | undefined;
  select: (skill: T) => void;
  updateDraft: (update: (current: string) => string) => void;
  unavailable: () => void;
}) {
  const initialized = useRef<string | null>(null);
  useEffect(() => {
    if (!ready) return;
    if (typeof requested !== 'string' || !requested) {
      initialized.current = null;
      return;
    }
    if (!skills || initialized.current === requested) return;
    initialized.current = requested;
    const skill = findTrySkill(requested, skills);
    if (!skill) { unavailable(); return; }
    select(skill);
    updateDraft(current => skillDraft(current, skill.name, true));
  }, [ready, requested, skills, select, updateDraft, unavailable]);
}
