import { beforeEach, expect, it, vi } from 'vitest';
import { generationApi, GenerationApiError } from './taskflow-generation';
const api = vi.hoisted(() => ({ get: vi.fn(), post: vi.fn(), put: vi.fn() }));
vi.mock('./index', () => ({ GET: api.get, POST: api.post, PUT: api.put }));
vi.mock('@/app/i18n', () => ({ default: { t: (key: string) => key } }));
beforeEach(() => vi.resetAllMocks());

it.each([401, 403, 404])('preserves HTTP %s so polling/recovery can distinguish failures', async status => {
  api.get.mockRejectedValue({ response: { status, data: { detail: 'Denied or missing' } } });
  await expect(generationApi('/S', undefined, 'GET')).rejects.toMatchObject({
    name: 'GenerationApiError', status, message: 'Denied or missing',
  });
});
it('preserves an application failure code without accepting it as success', async () => {
  api.post.mockResolvedValue({ status: 200, data: { success: false, err_code: 'NOT_FOUND', err_msg: 'Missing' } });
  const error = await generationApi('/S').catch(e => e);
  expect(error).toBeInstanceOf(GenerationApiError);
  expect(error).toMatchObject({ status: 200, code: 'NOT_FOUND', message: 'Missing' });
});
