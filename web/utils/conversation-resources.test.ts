import { expect, it } from 'vitest';
import { conversationResourcesFromHistory, resolveConversationResources } from './conversation-resources';

const turn = (resource_context: unknown) => ({ role: 'view', context: JSON.stringify({ type: 'react-agent', resource_context }) });
it('resolves only resources present in the current actor inventory and reports unavailable references', () => {
  const dbs = [{ db_name: 'demo' }], spaces = [{ id: 7, name: 'kb' }], skills = [{ id: 's1', name: 'analysis' }];
  expect(resolveConversationResources({ database_name: 'demo', knowledge_space_id: 7, skill_name: 'analysis' }, dbs, spaces, skills))
    .toEqual({ database: dbs[0], knowledge: spaces[0], skill: skills[0], missing: false });
  expect(resolveConversationResources({ database_name: 'revoked', knowledge_space_id: 999 }, dbs, spaces, skills))
    .toEqual({ database: null, knowledge: null, skill: null, missing: true });
  expect(resolveConversationResources({}, dbs, spaces, skills).missing).toBe(false);
});
it('restores DB/KB/skill references, rejects arbitrary keys, and respects explicit clearing', () => {
  expect(conversationResourcesFromHistory([turn({ database_name: 'db', knowledge_space_id: 7, skill_name: 'analysis', token: 'never-restore' })]))
    .toEqual({ database_name: 'db', knowledge_space_id: 7, skill_name: 'analysis' });
  expect(conversationResourcesFromHistory([turn({ database_name: 'db' }), turn({ database_name: null })])).toEqual({});
});
it('supports explicit legacy attachment prefixes but never infers a DB from prose', () => {
  expect(conversationResourcesFromHistory([{ role: 'human', context: '[Database: db] [Knowledge: kb] Question' }]))
    .toEqual({ database_name: 'db', knowledge_space_name: 'kb' });
  expect(conversationResourcesFromHistory([{ role: 'human', context: 'Query schema.public using database db' }])).toEqual({});
  expect(conversationResourcesFromHistory([turn({ database_name: 'other' }), turn([])])).toEqual({});
});

it('restores only a recorded selected skill and lets a newer explicit snapshot clear it', () => {
  const legacy = { role: 'view', context: JSON.stringify({ type: 'react-agent', steps: [
    { id: 'skill-read-selected', action: 'load_skill', action_input: { skill_name: 'analysis' } },
    { id: 'tool-read', action: 'load_skill', action_input: { skill_name: 'other' } },
  ] }) };
  expect(conversationResourcesFromHistory([legacy]).skill_name).toBe('analysis');
  expect(conversationResourcesFromHistory([legacy, turn({})])).toEqual({});
});
