const INTERRUPTED_NOTICES = new Set([
  '任务执行已中断，可继续任务。',
  '任务执行已中断，已保存的进度和结果已保留，可继续任务。',
  '执行已中断，可继续任务。',
]);

/** Localize only exact built-in legacy notices, never translate model answers. */
export function chatSystemNotice(text: string, language = 'en'): string {
  if (!INTERRUPTED_NOTICES.has(text.trim()) || language.startsWith('zh')) return text;
  return language.startsWith('vi')
    ? 'Tác vụ đã bị gián đoạn. Tiến độ và kết quả đã lưu được giữ lại; bạn có thể tiếp tục tác vụ.'
    : 'Execution was interrupted. Saved progress and results were retained; you can continue the task.';
}
