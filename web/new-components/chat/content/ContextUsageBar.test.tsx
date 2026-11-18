import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ContextUsageBar from './ContextUsageBar';

const locale = vi.hoisted(() => ({ language: 'zh' }));
vi.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: locale }) }));

afterEach(() => { cleanup(); locale.language = 'zh'; });

describe('ContextUsageBar', () => {
  it('labels restored measurements as previous instead of the next prompt', () => {
    locale.language = 'vi';
    render(<ContextUsageBar used={200} budget={1000} ratio={0.2} state='OK' variant='compact' previous measuredAt={1770000000000} />);
    expect(screen.getByRole('button').textContent).toContain('lượt trước');
    expect(screen.getByRole('tooltip').textContent).toContain('không phải prompt tiếp theo');
  });
  it('shows an explicit unknown state instead of a fabricated zero', () => {
    locale.language = 'vi';
    render(<ContextUsageBar used={0} budget={0} ratio={0} state='OK' known={false} variant='compact' />);
    expect(screen.getByRole('status').textContent).toContain('Ngữ cảnh · chờ đo');
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('shows a readable Vietnamese label and estimated usage', () => {
    locale.language = 'vi';
    render(<ContextUsageBar used={2000} budget={10000} ratio={0.2} state='OK' variant='compact' />);
    expect(screen.getByRole('button').textContent).toContain('Ngữ cảnh ~20%');
    expect(screen.getByRole('tooltip').textContent).toContain('ước lượng');
  });
  it('separates estimated input usage, total window and output reservation', () => {
    render(
      <ContextUsageBar
        used={13500}
        budget={1032192}
        ratio={0.0131}
        state='OK'
        contextWindow={1048576}
        reservedTokens={16384}
        windowSource='deployment_config'
        variant='compact'
      />,
    );
    expect(screen.getByRole('button').getAttribute('aria-label')).toContain('输入预算');
    expect(screen.getByRole('tooltip').textContent).toContain('约 13.5K / 1.03M');
    expect(screen.getByRole('tooltip').textContent).toContain('窗口 1.05M');
    expect(screen.getByRole('tooltip').textContent).toContain('输出预留 16.4K');
    expect(screen.getByRole('tooltip').textContent).toContain('模型部署配置');
  });

  it('labels an unresolved model limit as a fallback', () => {
    render(
      <ContextUsageBar used={10} budget={120000} ratio={0.001} state='OK' variant='compact' windowSource='fallback' />,
    );
    expect(screen.getByRole('tooltip').textContent).toContain('模型上限未知');
  });
});
