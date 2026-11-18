import { useRouter } from 'next/router';
import { useCallback, useEffect, useState, type Dispatch, type SetStateAction } from 'react';

/** Selection belongs to this conversation, not to the global model default. */
export function useConversationModel({ chatId, scene, historyModel, appModel, defaultModel, availableModels }: {
  chatId: string;
  scene: string;
  historyModel?: string;
  appModel?: string;
  defaultModel: string;
  availableModels?: string[];
}) {
  const router = useRouter();
  const routeModel = typeof router.query.model === 'string' ? router.query.model : '';
  const scope = `${scene}:${chatId}`;
  const [pending, setPending] = useState<{ scope: string; value: string; route: string } | null>(null);
  // Optimistic selection bridges the shallow replace. Once the route changes,
  // URL navigation (including Back/Forward) becomes authoritative again.
  useEffect(() => { setPending(null); }, [scope, routeModel]);
  const selected = pending?.scope === scope && pending.route === routeModel
    ? pending.value : routeModel || historyModel || appModel || defaultModel;
  const modelValue = availableModels?.length && !availableModels.includes(selected)
    ? (availableModels.includes(defaultModel) ? defaultModel : availableModels[0]) : selected;

  const setModelValue: Dispatch<SetStateAction<string>> = useCallback(value => {
    const next = typeof value === 'function' ? value(modelValue) : value;
    if (!next || next === modelValue) return;
    setPending({ scope, value: next, route: routeModel });
    // Preserve conversation/App/source parameters and the current hash. A model
    // switch is not a new conversation or an extra browser-history entry.
    void router.replace({
      pathname: router.pathname,
      query: { ...router.query, model: next },
      ...(router.asPath.includes('#') ? { hash: router.asPath.slice(router.asPath.indexOf('#')) } : {}),
    }, undefined, { shallow: true, scroll: false }).catch(error => {
      // Keep the usable in-memory selection if navigation fails; never turn a
      // router failure into an unhandled rejection or cancel an active reply.
      if (!error?.cancelled) console.warn('Unable to update conversation model URL');
    });
  }, [modelValue, routeModel, router, scope]);

  return { modelValue, setModelValue };
}
