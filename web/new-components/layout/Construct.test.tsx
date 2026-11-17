import { render, screen, cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_USERINFO_KEY } from '@/utils/constants/index';
import '@/app/i18n';
import ConstructLayout from './Construct';

const route = vi.hoisted(() => ({ pathname: '/construct/semantic', push: vi.fn() }));
vi.mock('next/router', () => ({ useRouter: () => route }));

afterEach(() => {
  cleanup();
  localStorage.removeItem(STORAGE_USERINFO_KEY);
  vi.unstubAllEnvs();
  route.pathname = '/construct/semantic';
});

describe('Construct module navigation', () => {
  it.each(['analyst', 'super_admin'])('renders Plugin content and selects its tab for %s', role => {
    route.pathname = '/construct/suites';
    vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '1');
    localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify({ role }));
    render(<ConstructLayout><h1>Plugin content</h1></ConstructLayout>);
    expect(screen.getByRole('heading', { name: 'Plugin content' })).not.toBeNull();
    const selected = screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true');
    expect(selected?.id).toContain('suites');
  });
  it.each(['analyst', 'super_admin'])('renders the current workflow route for %s', role => {
    route.pathname = '/construct/taskflow';
    vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '1');
    localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify({ role }));
    render(<ConstructLayout><h1>Workflow content</h1></ConstructLayout>);
    expect(screen.getByRole('heading', { name: 'Workflow content' })).not.toBeNull();
    const selected = screen.getAllByRole('tab').find(tab => tab.getAttribute('aria-selected') === 'true');
    expect(selected?.id).toContain('taskflow');
  });
  it.each(['analyst', 'super_admin'])('renders page content for %s', role => {
    vi.stubEnv('NEXT_PUBLIC_FUNNELMETRY_IDENTITY', '1');
    localStorage.setItem(STORAGE_USERINFO_KEY, JSON.stringify({ role }));
    render(<ConstructLayout><h1>Semantic page content</h1></ConstructLayout>);
    expect(screen.getByRole('heading', { name: 'Semantic page content' })).not.toBeNull();
    expect(screen.getByRole('tab', { name: /Trung tâm ngữ nghĩa/ }).getAttribute('aria-selected')).toBe('true');
    if (role === 'analyst') {
      expect(screen.queryByRole('tab', { name: /Nhà cung cấp/ })).toBeNull();
    }
  });
});
