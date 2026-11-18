import { describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ post: vi.fn() }));
vi.mock('./index', () => ({ POST: state.post, GET: vi.fn(), PUT: vi.fn(), DELETE: vi.fn() }));
import { newDialogue } from './request';

describe('new conversation request', () => {
  it('sends app binding as a query parameter understood by the native endpoint', () => {
    const data = { chat_mode: 'chat_normal', app_code: 'app/one & two', model: 'model+version' };
    newDialogue(data);
    const [url, body] = state.post.mock.calls.at(-1)!;
    const parsed = new URL(url, 'https://ai.test');
    expect(parsed.searchParams.get('app_code')).toBe(data.app_code);
    expect(parsed.searchParams.get('model_name')).toBe(data.model);
    expect(parsed.searchParams.get('chat_mode')).toBe('chat_normal');
    expect(body).toEqual(data);
  });
  it('does not send the literal undefined when a model is not selected', () => {
    newDialogue({ chat_mode: 'chat_agent' });
    const [url] = state.post.mock.calls.at(-1)!;
    expect(url).not.toContain('undefined');
  });
});
