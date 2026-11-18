import { describe, expect, it } from 'vitest';
import { chatSystemNotice } from './chat-system-notice';

describe('legacy built-in chat notices', () => {
  it('localizes known saved interruption notices without changing source history', () => {
    const source = '任务执行已中断，已保存的进度和结果已保留，可继续任务。';
    expect(chatSystemNotice(source, 'vi')).toContain('Tác vụ đã bị gián đoạn');
    expect(chatSystemNotice(source, 'en')).toContain('Execution was interrupted');
    expect(chatSystemNotice(source, 'zh')).toBe(source);
  });
  it('does not translate model/user text merely because it contains Chinese', () => {
    const text = '## SQL\n```sql\nSELECT 1;\n```\n用户数据';
    expect(chatSystemNotice(text, 'vi')).toBe(text);
  });
  it('localizes exact legacy chart notices while preserving error details and model text', () => {
    expect(chatSystemNotice('未选择数据库。', 'vi')).toBe('Chưa chọn nguồn dữ liệu. Hãy chọn cơ sở dữ liệu rồi thử lại.');
    expect(chatSystemNotice('未选择数据库。', 'en')).toBe('Select a data source before querying.');
    expect(chatSystemNotice('未选择数据库。', 'zh')).toBe('未选择数据库。');
    expect(chatSystemNotice('Select a data source before querying.', 'vi')).toContain('Chưa chọn nguồn dữ liệu');
    expect(chatSystemNotice('不支持的原生图表类型: response_unknown', 'vi')).toBe('Loại biểu đồ không được hỗ trợ: response_unknown');
    expect(chatSystemNotice('原生图表生成失败: relation missing', 'en')).toBe('Chart generation failed: relation missing');
    const answer = 'Thông báo cũ: 未选择数据库。 Hãy kiểm tra dữ liệu.';
    expect(chatSystemNotice(answer, 'vi')).toBe(answer);
  });
});
