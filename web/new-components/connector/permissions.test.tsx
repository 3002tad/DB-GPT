import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import '@/app/i18n';
import { STORAGE_USERINFO_KEY } from '@/utils/constants/index';
import Connectors from '@/pages/construct/connectors';
import ConnectorCard from './ConnectorCard';

vi.mock('next/router', () => ({ useRouter: () => ({ pathname: '/construct/connectors', push: vi.fn() }) }));
vi.mock('@/hooks/use-connector-api', () => ({
  useConnectors: () => ({ connectors: [], loading: false, refresh: vi.fn() }),
  useConnectorTypes: () => ({ types: [], loading: false }),
  useCreateConnector: () => ({ create: vi.fn() }),
  useUpdateConnector: () => ({ update: vi.fn() }),
  useDeleteConnector: () => ({ remove: vi.fn() }),
  useTestConnection: () => ({ test: vi.fn() }),
}));

afterEach(() => { cleanup(); localStorage.clear(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

it.each(['analyst', 'super_admin'])('shows management controls only to Admin (%s)', role => {
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '1');
  localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify({ role }));
  render(<Connectors />);
  const buttons = screen.queryAllByRole('button', { name: /Thêm kết nối/ });
  expect(buttons.length > 0).toBe(role === 'super_admin');
});

it('renders active connector identity without protected tool/config actions in read-only mode', () => {
  render(<ConnectorCard kind='instance' readOnly
    connector={{ id: 'fixture', connector_type: 'custom_mcp', display_name: 'Shared MCP', status: 'active' }}
    onEdit={vi.fn()} onDelete={vi.fn()} onTest={vi.fn()} />);
  expect(screen.getByText('Shared MCP')).not.toBeNull();
  expect(screen.queryAllByRole('button')).toHaveLength(0);
});

it('uses runtime identity when the bundle has no Pipeline flag or stored role', async () => {
  vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '');
  const readIdentity = vi.fn().mockResolvedValue({ ok: true, status: 200,
    json: async () => ({ actor: { role: 'analyst' } }),
  });
  vi.stubGlobal('fetch', readIdentity);
  render(<Connectors />);
  await waitFor(() => expect(readIdentity).toHaveBeenCalled());
  expect(screen.queryAllByRole('button', { name: /Thêm kết nối/ })).toHaveLength(0);
});
