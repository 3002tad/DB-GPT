import { Dispatch, SetStateAction, useCallback, useEffect, useRef, useState } from 'react';

/** Coalesce stream bursts without dropping/reordering functional updates. */
export function useStreamState<T>(initial: T) {
  const [value, commit] = useState(initial);
  const queue = useRef<SetStateAction<T>[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    if (timer.current !== null) clearTimeout(timer.current);
    timer.current = null;
    const pending = queue.current;
    queue.current = [];
    if (pending.length) commit(previous => pending.reduce<T>((state, update) =>
      typeof update === 'function' ? (update as (old: T) => T)(state) : update, previous));
  }, []);
  const setValue: Dispatch<SetStateAction<T>> = useCallback(update => {
    queue.current.push(update);
    if (timer.current === null) timer.current = setTimeout(flush, 40);
  }, [flush]);
  useEffect(() => () => {
    if (timer.current !== null) clearTimeout(timer.current);
    queue.current = [];
  }, []);
  return [value, setValue, flush] as const;
}
