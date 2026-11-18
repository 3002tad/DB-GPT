import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { message } from 'antd';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { downloadArtifact } from './ArtifactCards';
import ArtifactRail from './ArtifactRail';
import { artifactFileUrl, artifactImageUrl, PREVIEW_TEXT_LIMIT, readArtifactText } from './artifact-file';

vi.mock('@/utils', () => ({ getUserId: () => 'fixture-analyst' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ t: (_: string, fallback?: string) => fallback || _ }) }));
vi.mock('@/new-components/common/MarkdownContext', () => ({ default: () => null }));
vi.mock('@/new-components/dashboard/DashboardArtifactPreview', () => ({ default: () => null }));
vi.mock('next/dynamic', () => ({ default: () => () => null }));

const csv = { id: 'csv', type: 'file', name: 'summary.csv', filePath: '/app/pilot/tmp/session/exports/summary.csv' };
const png = {
  id: 'png',
  type: 'file',
  name: 'chart.png',
  content: { file_path: '/app/pilot/tmp/session/plots/chart.png' },
};
const props = { artifacts: [csv, png], onPreview: vi.fn(), onDebug: vi.fn(), onClose: vi.fn() };

function blobBytes(blob: Blob): Promise<ArrayBuffer> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as ArrayBuffer);
    reader.onerror = reject;
    reader.readAsArrayBuffer(blob);
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe('generated file preview and download', () => {
  it('reads a historical path-only CSV and shows its actual text', async () => {
    const fetcher = vi.fn().mockResolvedValue(new Response('source,total\nfacebook,10\ntiktok,7\n'));
    vi.stubGlobal('fetch', fetcher);
    const { container } = render(<ArtifactRail {...props} previewArtifact={csv} />);
    await waitFor(() => expect(container.querySelector('pre')?.textContent).toContain('facebook,10'));
    expect(fetcher.mock.calls[0][0]).toContain('file_path=%2Fapp%2Fpilot%2Ftmp%2Fsession');
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      credentials: 'include',
      headers: { 'user-id': 'fixture-analyst' },
    });
    expect(container.textContent).not.toContain('二进制办公');
  });

  it('renders a real PNG blob from nested path metadata and releases its URL', async () => {
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(bytes, { headers: { 'content-type': 'image/png' } })),
    );
    const create = vi.fn().mockReturnValue('blob:png-fixture');
    const revoke = vi.fn();
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = revoke;
      },
    );
    const { unmount } = render(<ArtifactRail {...props} previewArtifact={png} />);
    expect((await screen.findByAltText('chart.png')).getAttribute('src')).toBe('blob:png-fixture');
    expect(new Uint8Array(await blobBytes(create.mock.calls[0][0]))).toEqual(bytes);
    unmount();
    expect(revoke).toHaveBeenCalledWith('blob:png-fixture');
  });

  it('shows a missing file without fetching undefined or serializing metadata', async () => {
    const fetcher = vi.fn();
    vi.stubGlobal('fetch', fetcher);
    const artifact = { id: 'missing', type: 'file', name: 'missing.csv', content: { file_path: undefined } };
    render(<ArtifactRail {...props} previewArtifact={artifact} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetcher).not.toHaveBeenCalled();
    expect(artifactFileUrl({ ...artifact, filePath: 'undefined' })).toBeNull();
    expect(artifactImageUrl({ ...artifact, type: 'image', content: undefined })).toBeNull();
    expect(artifactImageUrl({ ...artifact, type: 'image', content: {} })).toBeNull();
  });

  it('reports a 404/403 and cancels an old preview when switching files', async () => {
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response('not found', { status: 404 }))
      .mockResolvedValueOnce(new Response('forbidden', { status: 403 }));
    vi.stubGlobal('fetch', fetcher);
    const { rerender } = render(<ArtifactRail {...props} previewArtifact={csv} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    rerender(<ArtifactRail {...props} previewArtifact={png} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(fetcher.mock.calls[0][1].signal.aborted).toBe(true);
    expect(screen.queryByRole('img', { name: 'chart.png' })).toBeNull();
  });

  it('does not let a slow response overwrite the newly selected file', async () => {
    let completeOld!: (response: Response) => void;
    const oldResponse = new Promise<Response>(resolve => {
      completeOld = resolve;
    });
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValueOnce(oldResponse).mockResolvedValueOnce(new Response('source,total\nzalo,9\n')),
    );
    const { container, rerender } = render(<ArtifactRail {...props} previewArtifact={csv} />);
    rerender(
      <ArtifactRail {...props} previewArtifact={{ ...csv, id: 'second', filePath: '/app/pilot/tmp/second.csv' }} />,
    );
    await waitFor(() => expect(container.querySelector('pre')?.textContent).toContain('zalo,9'));
    await act(async () => {
      completeOld(new Response('source,total\nfacebook,10\n'));
    });
    await waitFor(() => expect(container.querySelector('pre')?.textContent).not.toContain('facebook,10'));
    expect(container.querySelector('pre')?.textContent).toContain('zalo,9');
  });

  it('downloads source bytes from the bundle instead of JSON file metadata', async () => {
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(new Response('source,total\nfacebook,10\n')));
    vi.stubGlobal('fetch', fetcher);
    const create = vi.fn().mockReturnValue('blob:csv-fixture');
    vi.stubGlobal(
      'URL',
      class extends URL {
        static createObjectURL = create;
        static revokeObjectURL = vi.fn();
      },
    );
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const bundle = { id: 'bundle', type: 'artifact_bundle', name: 'exports', content: { items: [csv] } };
    render(<ArtifactRail {...props} previewArtifact={bundle} />);
    fireEvent.click(screen.getByText('下载'));
    await waitFor(() => expect(click).toHaveBeenCalledOnce());
    expect(new TextDecoder().decode(await blobBytes(create.mock.calls[0][0]))).toBe('source,total\nfacebook,10\n');
    expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe('summary.csv');
  });

  it('never offers a successful download for an HTTP error', async () => {
    const error = vi.spyOn(message, 'error').mockImplementation(() => (() => {}) as any);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('forbidden', { status: 403 })));
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    await downloadArtifact(csv);
    expect(click).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledOnce();
  });

  it('bounds text previews while leaving the full download untouched', async () => {
    const result = await readArtifactText(new Response('x'.repeat(PREVIEW_TEXT_LIMIT + 100)));
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBe(PREVIEW_TEXT_LIMIT);
  });

  it('rejects remote metadata URLs rather than forwarding actor credentials', () => {
    expect(artifactFileUrl({ ...csv, filePath: 'https://other.test/private.csv' })).toBeNull();
    expect(artifactFileUrl({ ...csv, filePath: '//other.test/private.csv' })).toBeNull();
  });
});
