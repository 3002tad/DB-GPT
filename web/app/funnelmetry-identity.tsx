import { createContext, useContext } from 'react';
import { STORAGE_USERINFO_KEY } from '@/utils/constants/index';

export type FunnelmetryIdentity = {
  integrated: boolean;
  role: string;
};

export const FunnelmetryIdentityContext = createContext<FunnelmetryIdentity | undefined>(undefined);

/** UI presentation only. The backend continues to authorize every API request. */
export function useFunnelmetryIdentity(): FunnelmetryIdentity {
  const identity = useContext(FunnelmetryIdentityContext);
  if (identity) return identity;
  // Standalone component consumers; the application provides runtime identity.
  let role = '';
  try {
    if (typeof window !== 'undefined') role = JSON.parse(localStorage.getItem(STORAGE_USERINFO_KEY) || '{}').role || '';
  } catch { /* no stored identity */ }
  return { integrated: process.env.NEXT_PUBLIC_FUNNELMETRY_IDENTITY === '1', role };
}

/** Only a missing integration endpoint permits the native standalone login. */
export async function discoverFunnelmetryActor(): Promise<{ id: string; role: string } | null> {
  const response = await fetch('/api/auth/funnelmetry/me', { credentials: 'same-origin', cache: 'no-store' });
  if (response.status === 404 && process.env.NEXT_PUBLIC_FUNNELMETRY_IDENTITY !== '1') return null;
  if (!response.ok) throw new Error('session_unavailable');
  const data = await response.json();
  if (typeof data?.actor?.id !== 'string' || !data.actor.id ||
      !['super_admin', 'analyst'].includes(data.actor.role)) throw new Error('invalid_actor');
  return { id: data.actor.id, role: data.actor.role };
}
