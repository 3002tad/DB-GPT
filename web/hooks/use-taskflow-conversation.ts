import i18n from '@/app/i18n';
import { generationApi } from '@/client/api/taskflow-generation';
import type { EditingSnapshot, GenerationRequest, GenerationSession } from '@/types/taskflow-generation';
import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The canvas stays the local source of truth. Serialized synchronization makes
 * every generation/save/run flush preceding manual edits before using versions.
 */
export function useTaskflowConversation(
  snapshot: EditingSnapshot,
  enabled: boolean,
  storageKey: string,
  onSnapshot: (snapshot: EditingSnapshot) => void,
) {
  const [session, setSession] = useState<GenerationSession | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const latest = useRef(snapshot);
  latest.current = snapshot;
  const current = useRef<GenerationSession | null>(null);
  const initialize = useRef<Promise<GenerationSession> | null>(null);
  const syncQueue = useRef<Promise<unknown>>(Promise.resolve());
  const mounted = useRef(true);
  const scope = useRef(storageKey);
  scope.current = storageKey;
  const pollEpoch = useRef(0);
  const submitting = useRef(false);
  const sessionKey = useRef(storageKey);
  const assertActive = useCallback(() => {
    if (!mounted.current || scope.current !== storageKey) throw new Error('Generation session changed');
  }, [storageKey]);
  const storage = (operation: 'get' | 'set' | 'remove', key: string, value = '') => {
    try {
      if (operation === 'get') return localStorage.getItem(key);
      if (operation === 'set') localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch { /* Session remains usable without browser persistence. */ }
    return null;
  };
  const activePoll = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSnapshotRef = useRef(onSnapshot);
  onSnapshotRef.current = onSnapshot;

  const accept = useCallback(
    (state: GenerationSession, apply = false) => {
      assertActive();
      current.current = state;
      if (mounted.current) {
        setSession(state);
        if (apply) onSnapshotRef.current(state.snapshot);
      }
      storage('set', storageKey, state.session_id);
      if (state.snapshot.meta.uid)
        storage('set', `taskflow-session:${state.snapshot.meta.uid}`, state.session_id);
      return state;
    },
    [storageKey, assertActive],
  );

  const ensure = useCallback(async () => {
    assertActive();
    if (sessionKey.current !== storageKey) {
      sessionKey.current = storageKey;
      current.current = null;
      initialize.current = null;
      syncQueue.current = Promise.resolve();
      pollEpoch.current++;
      if (activePoll.current) clearTimeout(activePoll.current);
      submitting.current = false;
      resumed.current = false;
      setSession(null); setBusy(false); setError(null);
    }
    if (current.current) return current.current;
    if (!initialize.current) {
      initialize.current = (async () => {
        const baseline = JSON.stringify(latest.current);
        const sid = storage('get', storageKey);
        if (sid) {
          try {
            return accept(await generationApi(`/${sid}`, undefined, 'GET'), JSON.stringify(latest.current) === baseline);
          } catch (err: any) {
            // Only a missing/deleted session is safe to replace.
            if (err.status !== 404 && err.code !== 'NOT_FOUND') throw err;
            storage('remove', storageKey);
          }
        }
        assertActive();
        const state = await generationApi(
          '',
          latest.current.meta.uid ? { flow_uid: latest.current.meta.uid } : { snapshot: latest.current },
        );
        return accept(state, JSON.stringify(latest.current) === baseline);
      })();
      const pending = initialize.current;
      pending.catch(() => {
        if (initialize.current === pending) initialize.current = null;
      });
    }
    return initialize.current;
  }, [accept, storageKey, assertActive]);

  const sync = useCallback(async () => {
    const operation = syncQueue.current
      .catch(() => {})
      .then(async () => {
        const state = await ensure();
        const local = latest.current;
        if (JSON.stringify(local) === JSON.stringify(state.snapshot)) return state;
        const result = await generationApi(
          `/${state.session_id}/draft`,
          {
            expected_draft_revision: state.draft_revision,
            snapshot: local,
          },
          'PUT',
        );
        return accept(result);
      });
    syncQueue.current = operation;
    return operation;
  }, [ensure, accept]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      pollEpoch.current++;
      if (activePoll.current) clearTimeout(activePoll.current);
    };
  }, []);

  useEffect(() => {
    if (enabled) void ensure().catch(err => { if (mounted.current && scope.current === storageKey) setError(err.message); });
  }, [enabled, ensure, storageKey]);

  const serialized = JSON.stringify(snapshot);
  const hasSession = !!session;
  useEffect(() => {
    if (!enabled || !hasSession) return;
    const timer = setTimeout(() => {
      void sync().catch(err => { if (mounted.current && scope.current === storageKey) setError(err.message); });
    }, 450);
    return () => clearTimeout(timer);
  }, [serialized, enabled, hasSession, sync, storageKey]);



  const poll = useCallback(
    (sid: string, rid: string, baseSnapshot: string) => {
      const epoch = ++pollEpoch.current;
      if (activePoll.current) clearTimeout(activePoll.current);
      let failures = 0;
      const valid = () => mounted.current && scope.current === storageKey && pollEpoch.current === epoch;
      const check = async () => {
        if (!valid()) return;
        activePoll.current = null;
        try {
          const state = await generationApi(`/${sid}`, undefined, 'GET');
          if (!valid()) return;
          failures = 0; setError(null);
          const request = state.requests[rid];
          const apply =
            request?.status === 'succeeded' &&
            state.draft_revision !== current.current?.draft_revision &&
            JSON.stringify(latest.current) === baseSnapshot;
          accept(state, apply);
          if (request?.status === 'running') {
            activePoll.current = setTimeout(check, 900);
          } else {
            setBusy(false);
            if (request?.status === 'failed') setError(request.error || i18n.t('taskflow_generation_failed', { defaultValue: 'Generation failed' }));
            if (!request) setError(i18n.t('taskflow_request_missing', { defaultValue: 'The saved generation request is unavailable. Refresh this flow.' }));
          }
        } catch (err: any) {
          if (!valid()) return;
          setError(err.message);
          if ([401, 403, 404].includes(err.status) || ['NOT_FOUND', 'UNAUTHORIZED', 'PERMISSION_DENIED'].includes(err.code)) {
            setBusy(false); return;
          }
          failures++;
          // Query the original request after a transient disconnect; never submit
          // another generation implicitly.
          activePoll.current = setTimeout(check, Math.min(30000, 2500 * 2 ** Math.min(failures - 1, 4)));
        }
      };
      void check();
    },
    [accept, storageKey],
  );

  const resumed = useRef(false);
  useEffect(() => {
    if (!session || resumed.current || session.session_id !== current.current?.session_id) return;
    resumed.current = true;
    const req = Object.values(session.requests).find(item => item.status === 'running');
    if (req) {
      setBusy(true);
      poll(session.session_id, req.request_id, JSON.stringify(latest.current));
    }
  }, [session, poll]);

  const send = useCallback(
    async (
      text: string,
      model: string,
      local: boolean,
      replace: boolean,
      answers: Record<string, string>,
      selectedId: string | null,
    ) => {
      if (submitting.current || busy) return false;
      submitting.current = true;
      setBusy(true);
      setError(null);
      try {
        const state = await sync();
        assertActive();
        const baseSnapshot = JSON.stringify(latest.current);
        const request = await generationApi<GenerationRequest>(`/${state.session_id}/messages`, {
          client_message_id: crypto.randomUUID(),
          expected_draft_revision: state.draft_revision,
          expected_context_revision: state.context_revision,
          text,
          model,
          answers,
          replace_candidate: replace,
          scope: local ? { type: 'nodes', node_ids: [selectedId] } : { type: 'flow' },
        });
        assertActive();
        poll(state.session_id, request.request_id, baseSnapshot);
        return true;
      } catch (err: any) {
        if (mounted.current && scope.current === storageKey) { setError(err.message); setBusy(false); }
        return false;
      } finally {
        if (scope.current === storageKey) submitting.current = false;
      }
    },
    [sync, poll, assertActive, storageKey, busy],
  );

  const action = useCallback(
    async (name: 'apply' | 'discard' | 'undo' | 'cancel') => {
      setError(null);
      setBusy(true);
      try {
        const state = name === 'cancel' ? await ensure() : await sync();
        const active = Object.values(state.requests).find(req => req.status === 'running');
        if (name === 'cancel' && !active) { setBusy(false); return; }
        if ((name === 'apply' || name === 'discard') && !state.candidate) {
          setBusy(false); return;
        }
        const path =
          name === 'cancel'
            ? `/requests/${active?.request_id}/cancel`
            : name === 'undo'
              ? '/undo'
              : `/candidates/${state.candidate?.candidate_id}/${name}`;
        const baseSnapshot = JSON.stringify(latest.current);
        const result = await generationApi(`/${state.session_id}${path}`, {});
        assertActive();
        if (name === 'cancel') { pollEpoch.current++; if (activePoll.current) clearTimeout(activePoll.current); }
        accept(result, (name === 'apply' || name === 'undo') && JSON.stringify(latest.current) === baseSnapshot);
      } catch (err: any) {
        if (mounted.current && scope.current === storageKey) setError(err.message);
      } finally {
        if (mounted.current && scope.current === storageKey) setBusy(false);
      }
    },
    [ensure, sync, accept, storageKey, assertActive],
  );

  const save = useCallback(
    async (publish: boolean) => {
      const state = await sync();
      const baseline = JSON.stringify(latest.current);
      const result = await generationApi(`/${state.session_id}/save`, {
        expected_draft_revision: state.draft_revision,
        publish,
      });
      accept(result, JSON.stringify(latest.current) === baseline);
      return result;
    },
    [sync, accept],
  );

  const refresh = useCallback(async () => {
    const state = await ensure();
    return accept(await generationApi(`/${state.session_id}`, undefined, 'GET'));
  }, [ensure, accept]);

  return { session, busy, error, send, action, sync, save, refresh };
}
