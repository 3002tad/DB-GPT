import { describe, expect, it } from 'vitest';
import { generatedFileOutput } from './generated-file-output';
import { envelopeEmbeddedOutputs } from './tool-envelope';

describe('generated file metadata', () => {
  it('never promotes traceback, source literals or final-answer filenames', () => {
    for (const content of [
      'Traceback (most recent call last): File "/usr/local/lib/pandas/io/common.py", line 42',
      "df.to_csv('/app/workspace/not-created.csv')\nplt.savefig('/app/workspace/chart.png')",
      'Wrote 12 bytes\nFileNotFoundError: /app/workspace/missing.csv\n/opt/lib/json/encoder.py',
      'Download report.csv and result.png. Their creation is planned.',
    ]) {
      for (const type of ['text', 'markdown', 'code']) {
        expect(generatedFileOutput({ output_type: type, content })).toBeNull();
      }
    }
  });

  it('preserves verified partial files without claiming producer success', () => {
    const content = { name: 'partial.csv', file_path: '/pilot/tmp/chat/partial.csv',
      size: 7, sha256: 'fixture', existence_verified: true, producer_status: 'failed' };
    expect(generatedFileOutput({ output_type: 'file', content })).toEqual(content);
  });

  it('accepts typed legacy exports, inline files and native write acknowledgements', () => {
    expect(generatedFileOutput({ output_type: 'file', content: { path: '/tmp/old.csv' } }))
      .toMatchObject({ name: 'old.csv', file_path: '/tmp/old.csv' });
    expect(generatedFileOutput({ output_type: 'file', content: { name: 'empty.md', content: '' } }))
      .toMatchObject({ name: 'empty.md', content: '' });
    const envelope = JSON.stringify({ chunks: [{ output_type: 'file', content: {
      name: 'native.csv', file_path: '/tmp/native.csv', size: 0,
    } }] });
    expect(envelopeEmbeddedOutputs(envelope).map(output => generatedFileOutput({ output_type: output.type, content: output.content })))
      .toMatchObject([{ name: 'native.csv', file_path: '/tmp/native.csv', size: 0 }]);
  });

  it('does not fabricate a path or downloadable file for malformed metadata', () => {
    for (const content of [null, {}, { name: 'missing.csv' }, { name: 'x.csv', file_path: 'undefined' },
      { name: 'x.csv', file_path: '/tmp/x.csv', existence_verified: false }]) {
      expect(generatedFileOutput({ output_type: 'file', content })).toBeNull();
    }
  });
});
