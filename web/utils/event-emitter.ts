type TaskClick = { taskId: string };
type EventMap = { task_click: TaskClick };
type Listener<T> = (payload: T) => void;

export const EVENTS = { TASK_CLICK: 'task_click' } as const;
const taskListeners = new Set<Listener<TaskClick>>();

export const ee = {
  on(event: typeof EVENTS.TASK_CLICK, listener: Listener<EventMap[typeof event]>) {
    taskListeners.add(listener);
    return () => taskListeners.delete(listener);
  },
  emit(event: typeof EVENTS.TASK_CLICK, payload: EventMap[typeof event]) {
    for (const listener of taskListeners) listener(payload);
  },
};
