export interface ConversationResources {
  database_name?: string | null;
  knowledge_space_name?: string | null;
  knowledge_space_id?: string | number | null;
  skill_name?: string | null;
  skill_id?: string | number | null;
}

export function resolveConversationResources<DB extends { db_name: string }, KB extends { id: string | number; name: string }, S extends { id: string | number; name: string }>(
  value: ConversationResources, databases: DB[], spaces: KB[], skills: S[],
) {
  const database = databases.find(item => item.db_name === value.database_name) || null;
  const knowledge = spaces.find(item => value.knowledge_space_id != null
    ? String(item.id) === String(value.knowledge_space_id) : item.name === value.knowledge_space_name) || null;
  const skill = skills.find(item => value.skill_id != null
    ? String(item.id) === String(value.skill_id) : item.name === value.skill_name) || null;
  return { database, knowledge, skill, missing: Boolean(
    value.database_name && !database || (value.knowledge_space_id || value.knowledge_space_name) && !knowledge ||
    (value.skill_id || value.skill_name) && !skill
  ) };
}

/** Selections are references, never credentials or execution authority. */
export function conversationResourcesFromHistory(messages: { role: string; context: string }[]): ConversationResources {
  let selection: ConversationResources = {};
  for (const message of messages) {
    if (message.role === 'human') {
      // Compatibility for histories written before resource_context existed.
      // Do not treat table names or prose as a resource selection.
      const db = message.context.match(/^\[Database: ([^\]\r\n]{1,256})\]/);
      const kb = message.context.match(/^(?:\[Database: [^\]\r\n]+\]\s*)?\[Knowledge: ([^\]\r\n]{1,256})\]/);
      if (db || kb) selection = { database_name: db?.[1] || null, knowledge_space_name: kb?.[1] || null };
    }
    if (message.role !== 'view') continue;
    try {
      const payload = JSON.parse(message.context);
      if (payload?.type !== 'react-agent') continue;
      if (!Object.hasOwn(payload, 'resource_context')) {
        const selected = Array.isArray(payload.steps)
          ? payload.steps.find((step: any) => step.id === 'skill-read-selected' && step.action === 'load_skill') : null;
        if (selected) {
          const input = typeof selected.action_input === 'string' ? JSON.parse(selected.action_input) : selected.action_input;
          if (typeof input?.skill_name === 'string' && input.skill_name.length <= 256) selection.skill_name = input.skill_name;
        }
        continue;
      }
      const raw = payload.resource_context;
      selection = {};
      if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
      for (const key of ['database_name', 'knowledge_space_name', 'knowledge_space_id', 'skill_name', 'skill_id'] as const) {
        const value = raw[key];
        if (typeof value === 'string' && value.length > 0 && value.length <= 256) selection[key] = value;
        else if ((key === 'knowledge_space_id' || key === 'skill_id') && Number.isSafeInteger(value) && value > 0) selection[key] = value;
      }
    } catch { /* Plain legacy answers carry no structured selection. */ }
  }
  return selection;
}
