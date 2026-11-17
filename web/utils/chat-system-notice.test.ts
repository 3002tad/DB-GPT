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
});
