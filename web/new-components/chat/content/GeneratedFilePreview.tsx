import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { artifactFileUrl, fetchArtifactFile, IMAGE_FILE, readArtifactText } from './artifact-file';
import type { RailArtifact } from './ArtifactRail';

export default function GeneratedFilePreview({ artifact }: { artifact: RailArtifact }) {
  const { t } = useTranslation();
  const url = artifactFileUrl(artifact);
  const image = IMAGE_FILE.test(artifact.name);
  const [preview, setPreview] = useState<{ text?: string; image?: string; error?: boolean; truncated?: boolean }>({});
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setPreview({});
    if (!url) {
      setPreview({ error: true });
      return () => controller.abort();
    }
    (async () => {
      try {
        const response = await fetchArtifactFile(url, controller.signal);
        if (image) {
          const blob = await response.blob();
          if (controller.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setPreview({ image: objectUrl });
        } else {
          const value = await readArtifactText(response);
          if (!controller.signal.aborted) setPreview(value);
        }
      } catch {
        if (!controller.signal.aborted) setPreview({ error: true });
      }
    })();
    return () => {
      controller.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url, image]);
  if (preview.error) return <div role='alert'>{t('ui_file_unavailable', 'File unavailable')}</div>;
  if (preview.image) return <img src={preview.image} alt={artifact.name} className='max-w-full rounded-lg' />;
  if (preview.text != null)
    return (
      <>
        {preview.truncated && (
          <p role='status'>{t('rail_file_preview_truncated', 'Preview truncated; download the complete file.')}</p>
        )}
        <pre className='overflow-auto whitespace-pre text-xs leading-5 p-3 rounded-lg bg-[#efefeb] dark:bg-white/[.04]'>
          {preview.text}
        </pre>
      </>
    );
  return <div role='status'>{t('rail_file_loading', 'Loading file…')}</div>;
}
