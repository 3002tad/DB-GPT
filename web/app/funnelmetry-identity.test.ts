import { afterEach, expect, it, vi } from 'vitest';
import { discoverFunnelmetryActor } from './funnelmetry-identity';

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

function response(status: number, body?: unknown) {
  const fetchIdentity = vi.fn().mockResolvedValue({ status, ok: status === 200, json: async () => body });
  vi.stubGlobal('fetch', fetchIdentity);
  return fetchIdentity;
}

it.each(['analyst', 'super_admin'])('discovers runtime %s without a build flag', async role => {
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '');
  const fetchIdentity = response(200, { actor: { id: 'actor-fixture', role } });
  await expect(discoverFunnelmetryActor()).resolves.toEqual({ id: 'actor-fixture', role });
  expect(fetchIdentity).toHaveBeenCalledWith('/api/auth/funnelmetry/me', {
    credentials: 'same-origin', cache: 'no-store',
  });
});

it('allows native standalone only when endpoint is absent and integration is not required', async () => {
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '');
  response(404);
  await expect(discoverFunnelmetryActor()).resolves.toBeNull();
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '1');
  await expect(discoverFunnelmetryActor()).rejects.toThrow('session_unavailable');
});

it.each([401, 403, 500, 503])('never falls back to native mock login on HTTP %s', async status => {
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '');
  response(status);
  await expect(discoverFunnelmetryActor()).rejects.toThrow('session_unavailable');
});

it.each([{ actor: { id: 'x', role: 'viewer' } }, { actor: { role: 'analyst' } }, {}])(
  'rejects malformed/unsupported identity %j', async body => {
    response(200, body);
    await expect(discoverFunnelmetryActor()).rejects.toThrow('invalid_actor');
  },
);

it('does not fall back to native login on network failure', async () => {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));
  await expect(discoverFunnelmetryActor()).rejects.toThrow('offline');
});
