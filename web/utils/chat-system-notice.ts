const INTERRUPTED_NOTICES = new Set([
  '任务执行已中断，可继续任务。',
  '任务执行已中断，已保存的进度和结果已保留，可继续任务。',
  '执行已中断，可继续任务。',
]);

/** Localize only exact built-in legacy notices, never translate model answers. */
export function chatSystemNotice(text: string, language = 'en'): string {
  if (!language.startsWith('zh')) {
    const vi = language.startsWith('vi');
    if (['未选择数据库。', '未选择数据库.', 'Select a data source before querying.'].includes(text.trim())) {
      return vi ? 'Chưa chọn nguồn dữ liệu. Hãy chọn cơ sở dữ liệu rồi thử lại.' : 'Select a data source before querying.';
    }
    const builtInPrefixes = [
      ['不支持的原生图表类型', vi ? 'Loại biểu đồ không được hỗ trợ' : 'Unsupported chart type'],
      ['原生图表生成失败', vi ? 'Không thể tạo biểu đồ' : 'Chart generation failed'],
    ];
    for (const [source, target] of builtInPrefixes) {
      const trimmed = text.trim();
      if (trimmed === source || trimmed === `${source}。`) return target;
      if (trimmed.startsWith(`${source}: `) || trimmed.startsWith(`${source}：`)) {
        return `${target}: ${trimmed.slice(source.length + 1).trimStart()}`;
      }
    }
  }
  if (!INTERRUPTED_NOTICES.has(text.trim()) || language.startsWith('zh')) return text;
  return language.startsWith('vi')
    ? 'Tác vụ đã bị gián đoạn. Tiến độ và kết quả đã lưu được giữ lại; bạn có thể tiếp tục tác vụ.'
    : 'Execution was interrupted. Saved progress and results were retained; you can continue the task.';
}
