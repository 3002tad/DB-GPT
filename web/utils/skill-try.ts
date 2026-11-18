/** Skill detail -> composer handoff. Names are resolved against the loaded list. */
export function skillTryRoute(name: string) {
  return { pathname: '/', query: { try_skill: name } };
}

export function findTrySkill<T extends { name: string }>(
  value: string | string[] | undefined,
  skills: readonly T[],
): T | undefined {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return skills.find(skill => skill.name === value);
}
