import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import { formatMoney } from '@stockflow/shared';
import App from './PreviewApp';
function setup(path: string, basePath = '') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App basePath={basePath} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => Response.json({ error: 'Database unavailable' }, { status: 503 })),
  );
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('Phase 1 route shells', () => {
  it.each([
    ['/dashboard', 'Dashboard'],
    ['/products', 'Products'],
    ['/inventory', 'Inventory'],
    ['/inventory/receipts', 'Stock receipts'],
    ['/inventory/counts', 'Stock counts'],
    ['/pos', 'Point of sale'],
    ['/sales', 'Sales history'],
    ['/reports', 'Reports'],
    ['/staff', 'Staff'],
    ['/settings', 'Settings'],
    ['/login', 'Welcome back.'],
    ['/unknown', 'Page not found'],
  ])('renders %s', async (path, title) => {
    setup(path);
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeTruthy();
    if (path !== '/login') expect(await screen.findByText('Database not verified')).toBeTruthy();
  });
  it('never labels a failed readiness check connected', async () => {
    setup('/dashboard');
    await screen.findByText('Database not verified');
    expect(screen.queryByText('Database reachable')).toBeNull();
  });
  it('shows a verified connection only after readiness succeeds', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Response.json({ status: 'ready' })),
    );
    setup('/dashboard');
    expect(await screen.findByText('Database reachable')).toBeTruthy();
  });
  it('opens and closes mobile navigation', () => {
    setup('/products');
    const button = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation', expanded: true }));
    expect(button.getAttribute('aria-expanded')).toBe('false');
  });
});
describe('catalogue and temporary cart', () => {
  it('defaults to the table, switches to photo cards and keeps demo navigation within preview', () => {
    setup('/preview/dashboard', '/preview');
    expect(screen.getByRole('link', { name: /Manage products/ }).getAttribute('href')).toBe(
      '/preview/products',
    );
    fireEvent.click(screen.getByRole('link', { name: 'Products' }));
    expect(screen.getByRole('button', { name: 'Table' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('table')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cards' }));
    expect(screen.queryByRole('table')).toBeNull();
    expect(screen.getByRole('img', { name: 'Representative photo of Rice 25kg' })).toBeTruthy();
  });
  it('filters POS categories without losing the cart and supports payment selection and removal', () => {
    setup('/pos');
    fireEvent.click(screen.getByRole('button', { name: /Bottled Water 1.5L/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Dairy' }));
    expect(screen.getByRole('heading', { name: 'Milk 1L' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Rice 25kg' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Remove Bottled Water 1.5L' })).toBeTruthy();
    fireEvent.click(screen.getByRole('radio', { name: 'Mobile money' }));
    expect(screen.getByText(/No money is transferred/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Remove Bottled Water 1.5L' }));
    expect(screen.getByText('Start with a product')).toBeTruthy();
    expect(
      (screen.getByRole('button', { name: 'Checkout planned' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/health/ready')),
    ).toBe(true);
  });
  it('filters sample products and shows an empty state', () => {
    setup('/products');
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'no-match' } });
    expect(screen.getByText('No matching products')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'Rice' } });
    expect(screen.getByRole('heading', { name: 'Rice 25kg' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Milk 1L' })).toBeNull();
  });
  it('opens an accessible product detail and closes it', () => {
    setup('/products');
    fireEvent.click(screen.getByRole('button', { name: 'Rice 25kg' }));
    expect(screen.getByRole('dialog', { name: 'Rice 25kg' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Close dialog' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });
  it('calculates a sample cart without permitting checkout or business API calls', () => {
    setup('/pos');
    fireEvent.click(screen.getByRole('button', { name: /Bottled Water 1.5L/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Bottled Water 1.5L' }));
    expect(screen.getAllByText('D 50.00').length).toBeGreaterThan(0);
    expect(
      (screen.getByRole('button', { name: 'Checkout planned' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/health/ready')),
    ).toBe(true);
  });
});
describe('login preview and money representation', () => {
  it('validates input and never authenticates or stores credentials', async () => {
    setup('/login');
    fireEvent.click(screen.getByRole('button', { name: 'Preview sign-in form' }));
    expect(await screen.findByText('Enter a valid email address')).toBeTruthy();
    expect(screen.getByText('Enter your password')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'test-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Preview sign-in form' }));
    await waitFor(() => expect(screen.getByText(/No session was created/)).toBeTruthy());
    expect(
      vi.mocked(fetch).mock.calls.every(([url]) => String(url).endsWith('/health/ready')),
    ).toBe(true);
  });
  it('formats integer minor units exactly and rejects fractional input', () => {
    expect(formatMoney(220001)).toBe('D 2,200.01');
    expect(formatMoney(-1)).toBe('-D 0.01');
    expect(() => formatMoney(0.1)).toThrow();
  });
});
