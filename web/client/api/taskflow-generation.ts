import i18n from '@/app/i18n';
import type { GenerationSession } from '@/types/taskflow-generation';
import { GET, POST, PUT } from './index';

const base = '/api/v2/serve/awel/taskflow/generation-sessions';

export class GenerationApiError extends Error {
  constructor(message: string, public status?: number, public code?: string | number) {
    super(message);
    this.name = 'GenerationApiError';
  }
}

/** Keep normal API authentication/headers and surface actionable HTTP errors. */
export async function generationApi<T = GenerationSession>(
  path: string,
  data?: unknown,
  method: 'GET' | 'POST' | 'PUT' = 'POST',
): Promise<T> {
  try {
    const response =
      method === 'GET'
        ? await GET<unknown, T>(`${base}${path}`)
        : method === 'PUT'
          ? await PUT<unknown, T>(`${base}${path}`, data)
          : await POST<unknown, T>(`${base}${path}`, data);
    if (!response.data.success) throw new GenerationApiError(response.data.err_msg || i18n.t('ui_request_error'), response.status, response.data.err_code ?? undefined);
    return response.data.data;
  } catch (error: any) {
    if (error instanceof GenerationApiError) throw error;
    const body = error.response?.data;
    const detail = body?.detail ?? body?.err_msg;
    throw new GenerationApiError(typeof detail === 'string' ? detail : detail ? JSON.stringify(detail) : error.message, error.response?.status, body?.err_code);
  }
}
