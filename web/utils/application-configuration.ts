import type { CreateAppParams } from '@/types/app';

const hasText = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

/** Validate the selected mode, rather than sending an empty union object to the API. */
export function applicationConfigurationError(params: CreateAppParams): string | null {
  const context = params.team_context;
  if (params.team_mode === 'native_app') {
    if (!hasText(context?.chat_scene)) return 'app_type_select';
    if (!hasText(context?.scene_name)) return 'app_scene_unavailable';
  }
  if (params.team_mode === 'awel_layout' && !hasText(context?.dag_id)) {
    return 'app_workflow_not_ready';
  }
  return null;
}
