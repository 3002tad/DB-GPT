import { describe, expect, it } from 'vitest';
import { applicationConfigurationError } from './application-configuration';

describe('application configuration matches the API mode contract', () => {
  it('requires an actual native scene and its loaded name', () => {
    expect(applicationConfigurationError({ team_mode: 'native_app', team_context: {} })).toBe('app_type_select');
    expect(
      applicationConfigurationError({
        team_mode: 'native_app',
        team_context: { chat_scene: 'chat_with_db_qa' },
      }),
    ).toBe('app_scene_unavailable');
    expect(
      applicationConfigurationError({
        team_mode: 'native_app',
        team_context: { chat_scene: 'chat_with_db_qa', scene_name: 'Chat DB' },
      }),
    ).toBeNull();
  });

  it('rejects a cleared workflow or a draft without a DAG', () => {
    for (const context of [{}, { name: 'draft' }, { dag_id: '  ' }]) {
      expect(applicationConfigurationError({ team_mode: 'awel_layout', team_context: context })).toBe(
        'app_workflow_not_ready',
      );
    }
    expect(
      applicationConfigurationError({
        team_mode: 'awel_layout',
        team_context: { dag_id: 'flow_dag_1' },
      }),
    ).toBeNull();
  });

  it('does not impose native scene requirements on single-agent or auto-plan apps', () => {
    for (const mode of ['single_agent', 'auto_plan']) {
      expect(applicationConfigurationError({ team_mode: mode, details: [{ agent_name: 'Data analyst' }] })).toBeNull();
    }
  });
});
