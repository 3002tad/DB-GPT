import { useCallback, useEffect, useRef, useState } from 'react';
import { getConversationUsage, type ConversationUsage } from '@/client/api';
import { getUserId } from '@/utils/storage';

export interface ContextMeasurement {
  state: 'OK' | 'WARNING' | 'ERROR';
  used_tokens: number;
  max_tokens: number;
  usage_percent: number;
  layer: string | null;
  model?: string;
  context_window?: number;
  reserved_tokens?: number;
  window_source?: string;
  measured_at?: number;
  previous?: boolean;
}

export function validMeasurement(value: any): value is ContextMeasurement {
  return value && ['OK', 'WARNING', 'ERROR'].includes(value.state) &&
    typeof value.model === 'string' && value.model.length > 0 && value.model.length <= 256 &&
    Number.isFinite(value.used_tokens) && value.used_tokens >= 0 &&
    Number.isFinite(value.max_tokens) && value.max_tokens > 0 &&
    Number.isFinite(value.usage_percent) && value.usage_percent >= 0;
}

export function contextSnapshotsFromHistory(messages: any[]): Record<string, ContextMeasurement> {
  const snapshots: Record<string, ContextMeasurement> = Object.create(null);
  for (const message of messages) {
    if (message?.role !== 'view') continue;
    let payload = message.context;
    try { if (typeof payload === 'string') payload = JSON.parse(payload); } catch { continue; }
    if (payload?.type !== 'react-agent' || !payload.context_snapshots || typeof payload.context_snapshots !== 'object') continue;
    for (const [model, value] of Object.entries(payload.context_snapshots)) {
      if (!validMeasurement(value) || value.model !== model ||
          !Number.isFinite(value.measured_at) || Number(value.measured_at) <= 0) continue;
      const existing = snapshots[model];
      if (!existing || Number(value.measured_at) >= Number(existing.measured_at)) {
        // Pick known display fields; arbitrary persisted metadata is not UI state.
        snapshots[model] = {
          model, state: value.state, used_tokens: value.used_tokens,
          max_tokens: value.max_tokens, usage_percent: value.usage_percent,
          layer: typeof value.layer === 'string' ? value.layer : null,
          measured_at: value.measured_at, previous: true,
          context_window: typeof value.context_window === 'number' && Number.isFinite(value.context_window) && value.context_window >= 0 ? value.context_window : undefined,
          reserved_tokens: typeof value.reserved_tokens === 'number' && Number.isFinite(value.reserved_tokens) && value.reserved_tokens >= 0 ? value.reserved_tokens : undefined,
          window_source: typeof value.window_source === 'string' ? value.window_source : undefined,
        };
      }
    }
  }
  return snapshots;
}

/** Server history is the durable source; React holds only the current projection. */
export function useConversationContext(conversationId: string | null, model: string) {
  const owner = getUserId();
  const key = JSON.stringify([owner, conversationId]);
  const [snapshot, setSnapshot] = useState<{ key: string; values: Record<string, ContextMeasurement> }>({ key, values: {} });
  const activeKey = useRef(key);
  activeKey.current = key;
  const setContextStatus = useCallback((value: ContextMeasurement | null, scope?: { conversationId: string; model: string }) => {
    const target = scope ? JSON.stringify([owner, scope.conversationId]) : key;
    if (activeKey.current !== target && activeKey.current !== key) return;
    if (!value) { setSnapshot({ key: target, values: {} }); return; }
    const boundModel = scope?.model || model;
    if (value.model && value.model !== boundModel) return;
    const measured = {
      ...value, model: boundModel,
      measured_at: Number.isFinite(value.measured_at) ? value.measured_at : Date.now(), previous: false,
    };
    if (!validMeasurement(measured)) return;
    setSnapshot(current => ({ key: target, values: {
      ...(current.key === target ? current.values : {}), [boundModel]: measured,
    } }));
  }, [key, owner, model]);
  const restoreContextHistory = useCallback((messages: any[], convId: string) => {
    const target = JSON.stringify([owner, convId]);
    if (activeKey.current !== target && activeKey.current !== key) return;
    const restored = contextSnapshotsFromHistory(messages);
    setSnapshot(current => {
      if (current.key === target) {
        for (const [name, value] of Object.entries(current.values)) {
          if (!restored[name] || Number(value.measured_at) >= Number(restored[name].measured_at)) restored[name] = value;
        }
      }
      return { key: target, values: restored };
    });
  }, [key, owner]);
  const markPrevious = useCallback(() => {
    setSnapshot(current => current.key === key && current.values[model]
      ? { ...current, values: { ...current.values, [model]: { ...current.values[model], previous: true } } } : current);
  }, [key, model]);
  return { contextStatus: snapshot.key === key && Object.hasOwn(snapshot.values, model) ? snapshot.values[model] : null,
    setContextStatus, restoreContextHistory, markPrevious };
}

export interface TokenTotal { total: number | null; complete: boolean; calls: number }

/** A client-generated ID alone is not proof that the server has stored a chat. */
export function useConversationUsageReady(conversationId: string | null) {
  const owner = getUserId();
  const scope = JSON.stringify([owner, conversationId]);
  const active = useRef(scope);
  active.current = scope;
  const [confirmed, setConfirmed] = useState<string | null>(null);
  const confirmUsageReady = useCallback((id: string) => {
    const target = JSON.stringify([owner, id]);
    if (owner && id && (active.current === target || active.current === scope)) setConfirmed(target);
  }, [owner, scope]);
  return { usageReady: Boolean(owner && conversationId && confirmed === scope), confirmUsageReady };
}

/** Sum provider aggregates once, never SSE deltas or parent trace spans. */
export function conversationTokenTotal(usage: ConversationUsage | null): TokenTotal {
  if (!usage || usage.source !== 'provider' || !usage.models.length) return { total: null, complete: false, calls: 0 };
  let total = 0;
  let calls = 0;
  let known = false;
  let complete = true;
  for (const item of usage.models) {
    calls += item.calls;
    const value = item.complete ? item.total_tokens : item.known_total_tokens;
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0) {
      total += value;
      // A partial aggregate of zero with no reported calls is not a known zero.
      known ||= item.complete || (item.reported_calls ?? 0) > 0 || value > 0;
    } else complete = false;
    complete &&= item.complete;
  }
  return { total: known ? total : null, complete: known && complete && calls > 0, calls };
}

export function useConversationTokens(conversationId: string | null, running: boolean, ready = true) {
  const owner = getUserId();
  const scope = JSON.stringify([owner, conversationId]);
  const [result, setResult] = useState<{ scope: string; usage: ConversationUsage | null; failed: boolean } | null>(null);
  useEffect(() => {
    if (!conversationId || !owner || !ready) return;
    let cancelled = false;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        // Read only after server persistence is confirmed. Background telemetry
        // errors must not surface through the global request-error toast.
        const response = await getConversationUsage(conversationId);
        const data = response.data.success ? response.data.data : null;
        if (!cancelled) setResult({ scope, usage: data || null, failed: !data });
      } catch {
        if (!cancelled) setResult({ scope, usage: null, failed: true });
      } finally { pending = false; }
    };
    void refresh();
    // Poll only during execution; one delayed refresh covers telemetry flush
    // after completion. Refresh on browser focus for a resumed conversation.
    const timer = running ? window.setInterval(refresh, 10000) : undefined;
    const trailing = !running ? window.setTimeout(refresh, 2000) : undefined;
    window.addEventListener('focus', refresh);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.clearTimeout(trailing);
      window.removeEventListener('focus', refresh);
    };
  }, [scope, conversationId, owner, running, ready]);
  const current = result?.scope === scope ? result : null;
  return { ...conversationTokenTotal(current?.usage || null), failed: current?.failed || false };
}
