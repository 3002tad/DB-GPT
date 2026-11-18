import { getUserId } from '@/utils';
import { HEADER_USER_ID_KEY } from '@/utils/constants/index';

type FileArtifact = { type: string; name: string; filePath?: string; content?: any };
export const IMAGE_FILE = /\.(png|jpe?g|gif|webp|svg)$/i;
export const TEXT_FILE = /\.(csv|tsv|txt|md|markdown|json|py|js|ts|tsx|jsx|sql|sh|drawio|dbml|mmd)$/i;

export function artifactFilePath(artifact: FileArtifact): string | null {
  const values = [artifact.filePath, artifact.content?.file_path, artifact.content?.path];
  return (
    values
      .find(value => typeof value === 'string' && value.trim() && !/^(undefined|null)$/i.test(value.trim()))
      ?.trim() || null
  );
}

/** Resolve file references only; inline HTML, code and query payloads are not paths. */
export function artifactFileUrl(artifact: FileArtifact): string | null {
  const raw = artifactFilePath(artifact);
  if (!raw) return null;
  const path = raw.replace(/\\/g, '/');
  if (/^\/images\//.test(path) || /^\/api\/v1\/(?:chat\/harness\/artifact-file|agent\/files\/download)\?/.test(path)) {
    return path;
  }
  // Never turn a remote URL or malformed metadata into a local file request.
  if (/^[a-z]+:/i.test(path) && !/^[A-Z]:\//i.test(path)) return null;
  if (path.startsWith('//')) return null;
  if (IMAGE_FILE.test(artifact.name) && path.includes('/message/img/')) {
    return `/images/${encodeURIComponent(path.split('/').pop()!)}`;
  }
  return `/api/v1/agent/files/download?file_path=${encodeURIComponent(raw)}`;
}

export function artifactImageUrl(artifact: FileArtifact): string | null {
  if (artifact.type === 'image' && typeof artifact.content === 'string') {
    const value = artifact.content.trim();
    return /^(?:https?:\/\/|data:image\/|blob:|\/images\/|\/api\/v1\/(?:chat\/harness\/artifact-file|agent\/files\/download)\?)/i.test(
      value,
    )
      ? value
      : null;
  }
  return IMAGE_FILE.test(artifact.name) ? artifactFileUrl(artifact) : null;
}

/** The same actor header/cookies as other API calls; URL is a local file route. */
export async function fetchArtifactFile(url: string, signal?: AbortSignal): Promise<Response> {
  if (!/^\/(?:images\/|api\/v1\/(?:agent\/files\/download|chat\/harness\/artifact-file)\?)/.test(url)) {
    throw new Error('Invalid artifact file URL');
  }
  const userId = getUserId();
  const headers: HeadersInit = userId ? { [HEADER_USER_ID_KEY]: userId } : {};
  const response = await fetch(`${process.env.API_BASE_URL || ''}${url}`, {
    credentials: 'include',
    headers,
    signal,
  });
  if (!response.ok) throw new Error(`File unavailable (${response.status})`);
  return response;
}

export const PREVIEW_TEXT_LIMIT = 256 * 1024;

export async function readArtifactText(response: Response): Promise<{ text: string; truncated: boolean }> {
  if (!response.body) {
    const text = await response.text();
    return { text: text.slice(0, PREVIEW_TEXT_LIMIT), truncated: text.length > PREVIEW_TEXT_LIMIT };
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = '';
  let bytes = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) return { text: text + decoder.decode(), truncated: false };
      const remaining = PREVIEW_TEXT_LIMIT - bytes;
      if (value.byteLength > remaining) {
        text += decoder.decode(value.subarray(0, remaining));
        return { text, truncated: true };
      }
      text += decoder.decode(value, { stream: true });
      bytes += value.byteLength;
    }
  } finally {
    await reader.cancel();
  }
}
