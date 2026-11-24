import { RefObject, useEffect, useRef } from 'react';

/** Follow only while the reader remains at the bottom, including iframe scroll. */
export function useChatFollowScroll(end: RefObject<HTMLElement | null>, revision: unknown) {
  const following = useRef(true);
  const programmatic = useRef(false);
  useEffect(() => {
    const mark = (event: Event) => {
      if (programmatic.current || !end.current) return;
      const target = event.target;
      if (target instanceof HTMLElement && target.contains(end.current)) {
        following.current = target.scrollHeight - target.scrollTop - target.clientHeight <= 120;
      } else if (target === document) {
        const root = document.scrollingElement;
        if (root) following.current = root.scrollHeight - root.scrollTop - root.clientHeight <= 120;
      }
    };
    // Capture observes scrolling in nested containers as well as the document.
    document.addEventListener('scroll', mark, true);
    return () => document.removeEventListener('scroll', mark, true);
  }, [end]);
  useEffect(() => {
    if (!following.current) return;
    const frame = requestAnimationFrame(() => {
      programmatic.current = true;
      end.current?.scrollIntoView({ behavior: 'instant' as ScrollBehavior, block: 'end' });
      programmatic.current = false;
    });
    return () => cancelAnimationFrame(frame);
  }, [end, revision]);
}
