import { describe, expect, it, vi } from 'vitest';

import { buildQueryCsv, downloadQueryCsv } from './query-export';

describe('buildQueryCsv', () => {
  it('emits header + escaped rows with CRLF', () => {
    const csv = buildQueryCsv({ sql: 'SELECT demo',
      columns: ['品类', '金额'],
      rows: [
        ['美妆,护肤', 'say "hi"'],
        [386.2, null],
      ],
    });
    // buildQueryCsv is BOM-free; downloadQueryCsv prepends the BOM.
    const lines = csv.split('\r\n');
    expect(lines[0]).toBe('品类,金额');
    expect(lines[1]).toBe('"美妆,护肤","say ""hi"""');
    expect(lines[2]).toBe('386.2,');
  });

  it('handles empty result sets', () => {
    const csv = buildQueryCsv({ sql: 'SELECT demo', columns: ['a'], rows: [] });
    expect(csv).toBe('a');
  });

  it('keeps the blob alive until the browser can start its download', () => {
    vi.useFakeTimers();
    const revoke = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: () => 'blob:query', revokeObjectURL: revoke });
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
      expect(this.isConnected).toBe(true);
      expect(this.download).toBe('query.csv');
    });
    try {
      downloadQueryCsv({ sql: 'SELECT 1', columns: ['n'], rows: [[1]] }, 'query');
      expect(click).toHaveBeenCalledOnce();
      expect(revoke).not.toHaveBeenCalled();
      expect(document.querySelector('a[download]')).toBeNull();
      vi.advanceTimersByTime(1000);
      expect(revoke).toHaveBeenCalledExactlyOnceWith('blob:query');
    } finally {
      vi.useRealTimers(); vi.unstubAllGlobals(); click.mockRestore();
    }
  });
});
