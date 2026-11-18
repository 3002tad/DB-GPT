import i18n from '@/app/i18n';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import ModelContextMetadata from './ModelContextMetadata';

const model = { model: 'fixture', label: 'Fixture', context_length: 256000, max_output_length: 16000, function_calling: true, link: null, description: null, enabled: true, metadata_source: 'Provider console', metadata_checked_at: '2026-11-18', metadata_declaration: 'user_config' };
beforeEach(async () => { await i18n.changeLanguage('vi'); });
afterEach(cleanup);
it('shows the manually declared window and provenance without presenting it as verified quota', () => {
  render(<ModelContextMetadata model={model} />);
  const window = screen.getByText('256K');
  expect(window.title).toContain('2026-11-18');
  expect(window.title).toContain(model.metadata_source);
  expect(window.title).toContain('Do quản trị viên khai báo');
  expect(window.title).toContain('không phải quota token còn lại');
});
it('labels an unknown context instead of displaying the composer fallback as verified metadata', () => {
  render(<ModelContextMetadata model={{ ...model, context_length: null, metadata_source: undefined }} />);
  expect(screen.getByText('—').title).toContain('Chưa xác minh');
  expect(screen.queryByText('120K')).toBeNull();
});
