import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import {
  formatMoney,
  parseMoneyInput,
  parseQuantityInput,
  quantityInputValue,
} from '@stockflow/shared';
import App from './App';
import type { Product } from './features/catalogue';
import { MinorEstimate } from './features/workflows';
import type { SaleRecord } from './features/receipts';

const businessId = '20000000-0000-4000-8000-000000000001';
const category = { id: '20000000-0000-4000-8000-000000000002', name: 'Grains' };
const product: Product = {
  id: '20000000-0000-4000-8000-000000000003',
  name: 'Rice 25kg',
  sku: 'RICE-25',
  barcode: '6151001',
  categoryId: category.id,
  category,
  unit: 'bag',
  lowStockThreshold: '5.000',
  purchaseCostMinor: '185000',
  sellingPriceMinor: '220000',
  isActive: true,
  quantity: '50',
};
let signedIn: boolean,
  role: 'OWNER' | 'MANAGER' | 'CASHIER',
  products: Product[],
  failProducts: boolean;
let categories: { id: string; name: string }[],
  suppliers: { id: string; name: string; isActive: boolean }[];
let recordedSales: SaleRecord[];
let saleFailure: number | undefined, saleGate: Promise<void> | undefined;
const session = () => ({
  user: { id: 'user', name: 'Shop owner', email: 'owner@example.test', role },
  business: { id: businessId, name: 'Test Mart', isDemo: false, currency: 'GMD' },
  csrfToken: 'a'.repeat(64),
  expiresAt: new Date(Date.now() + 3600000).toISOString(),
  branchAccess: 'NOT_ASSIGNED',
});
function setup(path = '/products') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter
        initialEntries={[path]}
        future={{ v7_startTransition: true, v7_relativeSplatPath: true }}
      >
        <App />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  signedIn = true;
  role = 'OWNER';
  products = [{ ...product }];
  categories = [{ ...category }];
  suppliers = [];
  failProducts = false;
  recordedSales = [];
  saleFailure = undefined;
  saleGate = undefined;
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, options: RequestInit = {}) => {
      const parsed = new URL(String(url), 'http://localhost'),
        path = parsed.pathname,
        method = options.method ?? 'GET';
      if (path.endsWith('/health/ready')) return Response.json({ status: 'ready' });
      if (path.endsWith('/auth/session'))
        return signedIn
          ? Response.json(session())
          : Response.json({ error: 'Sign in to continue' }, { status: 401 });
      if (path.endsWith('/auth/login')) {
        const input = JSON.parse(String(options.body));
        if (input.password === 'invalid')
          return Response.json({ error: 'Invalid business, email or password' }, { status: 401 });
        signedIn = true;
        return Response.json(session());
      }
      if (path.endsWith('/auth/logout')) {
        signedIn = false;
        return new Response(null, { status: 204 });
      }
      if (path.endsWith('/customers'))
        return Response.json({ data: [], total: 0, page: 1, limit: 25 });
      if (path.endsWith('/sales') && method === 'POST') {
        if (saleGate) await saleGate;
        if (saleFailure)
          return Response.json({ error: 'Sale could not be saved' }, { status: saleFailure });
        const body = JSON.parse(String(options.body));
        const total = products.reduce(
          (sum, p) =>
            sum +
            MinorEstimate(
              p.sellingPriceMinor,
              String(
                body.items.find((i: { productId: string }) => i.productId === p.id)?.quantity ??
                  '0',
              ),
            ),
          0n,
        );
        const amountReceivedMinor = body.exactPayment
          ? String(total)
          : body.amountReceived !== undefined
            ? parseMoneyInput(body.amountReceived)
            : body.amountReceivedMinor;
        const sale = {
          id: 'sale-test',
          receiptNumber: 'SF-TEST',
          createdAt: new Date().toISOString(),
          cashierName: 'Shop owner',
          paymentMethod: body.paymentMethod,
          subtotalMinor: String(total),
          discountMinor: '0',
          totalMinor: String(total),
          amountReceivedMinor,
          changeMinor: String(BigInt(amountReceivedMinor) - total),
          returns: [],
          receiptSnapshot: { businessName: 'Test Mart', cashierName: 'Shop owner' },
          items: body.items.map((i: { productId: string; quantity: string }) => {
            const p = products.find((p) => p.id === i.productId)!;
            return {
              id: 'line-test',
              productId: p.id,
              productName: p.name,
              productSku: p.sku,
              quantity: i.quantity,
              unitPriceMinor: p.sellingPriceMinor,
              lineTotalMinor: String(MinorEstimate(p.sellingPriceMinor, i.quantity)),
              discountMinor: '0',
            };
          }),
        };
        recordedSales.push(sale);
        return Response.json(sale, { status: 201 });
      }
      if (path.endsWith('/sales') && method === 'GET')
        return Response.json({
          data: recordedSales,
          page: 1,
          limit: 25,
          total: recordedSales.length,
        });
      if (path.endsWith('/products') && method === 'GET') {
        if (failProducts)
          return Response.json({ error: 'Database request failed' }, { status: 503 });
        const search = parsed.searchParams.get('search') ?? '',
          cat = parsed.searchParams.get('categoryId');
        const rows = products.filter(
          (p) =>
            (p.name + ' ' + p.sku + ' ' + p.barcode).toLowerCase().includes(search.toLowerCase()) &&
            (!cat || p.categoryId === cat),
        );
        return Response.json({ data: rows, page: 1, limit: 24, total: rows.length });
      }
      if (path.endsWith('/products') && method === 'POST') {
        const body = JSON.parse(String(options.body));
        const p = {
          ...product,
          ...body,
          sku: body.sku || 'PRD-000001',
          id: 'new-product',
          category: categories.find((c) => c.id === body.categoryId) ?? null,
        };
        products.push(p);
        return Response.json(p, { status: 201 });
      }
      if (/\/products\/[^/]+$/.test(path) && method === 'PATCH') {
        const id = path.split('/').at(-1),
          body = JSON.parse(String(options.body));
        products = products.map((p) => (p.id === id ? { ...p, ...body } : p));
        return Response.json(products.find((p) => p.id === id));
      }
      if (path.endsWith('/categories')) {
        if (method === 'POST') {
          const item = { id: 'new-category', ...JSON.parse(String(options.body)) };
          categories.push(item);
          return Response.json(item, { status: 201 });
        }
        return Response.json(categories);
      }
      if (path.endsWith('/suppliers')) {
        if (method === 'POST') {
          const item = { id: 'new-supplier', ...JSON.parse(String(options.body)) };
          suppliers.push(item);
          return Response.json(item, { status: 201 });
        }
        return Response.json(suppliers);
      }
      return Response.json({ error: 'Unexpected test route' }, { status: 404 });
    }),
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});
describe('operational authentication and catalogue', () => {
  it.each([
    ['/', 'Dashboard'],
    ['/dashboard', 'Dashboard'],
    ['/products', 'Products'],
    ['/categories', 'Categories'],
    ['/suppliers', 'Suppliers'],
    ['/inventory', 'Inventory'],
    ['/inventory/receipts', 'Stock receipts'],
    ['/inventory/counts', 'Stock history'],
    ['/pos', 'Point of sale'],
    ['/sales', 'Sales history'],
    ['/reports', 'Reports'],
    ['/staff', 'Staff'],
    ['/settings', 'Settings'],
    ['/unknown', 'Page not found'],
  ])('retains the authenticated route %s', async (path, title) => {
    setup(path);
    expect(await screen.findByRole('heading', { name: title, level: 1 })).toBeTruthy();
  });
  it('filters the POS using API category IDs and removes a line without submitting a transaction', async () => {
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Grains' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url]) =>
              String(url).includes('active=true') &&
              String(url).includes('categoryId=' + category.id),
          ),
      ).toBe(true),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove Rice 25kg' }));
    expect(screen.getByText('Start with a product')).toBeTruthy();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.every(([, options]) => !options?.method || options.method === 'GET'),
    ).toBe(true);
  });
  it('signs in and logs out with a CSRF header and credentialed requests', async () => {
    signedIn = false;
    setup('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Business ID (optional)'), {
      target: { value: businessId },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), {
      target: { value: 'local-test-password' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByRole('heading', { name: 'Dashboard', level: 1 })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Log out' }));
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
    const call = vi.mocked(fetch).mock.calls.find(([url]) => String(url).endsWith('/auth/logout'))!;
    expect(call[1]?.credentials).toBe('include');
    expect((call[1]?.headers as Record<string, string>)['X-CSRF-Token']).toBe('a'.repeat(64));
  });
  it('shows generic login failures without entering the workspace', async () => {
    signedIn = false;
    setup('/login');
    await screen.findByRole('button', { name: 'Sign in' });
    fireEvent.change(screen.getByLabelText('Business ID (optional)'), {
      target: { value: businessId },
    });
    fireEvent.change(screen.getByLabelText('Email address'), {
      target: { value: 'owner@example.test' },
    });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'invalid' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));
    expect(await screen.findByText('Invalid business, email or password')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Log out' })).toBeNull();
  });
  it('loads API products, searches and filters, and shows empty results', async () => {
    setup();
    await screen.findByRole('heading', { name: 'Rice 25kg' });
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'no-match' } });
    expect(await screen.findByText('No matching products')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Search products'), { target: { value: 'RICE-25' } });
    await screen.findByRole('heading', { name: 'Rice 25kg' });
    fireEvent.change(screen.getByLabelText('Category filter'), { target: { value: category.id } });
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(([url]) => String(url).includes('categoryId=' + category.id)),
      ).toBe(true),
    );
  });
  it('validates a product form then sends exact minor-unit strings', async () => {
    setup();
    await screen.findByRole('button', { name: 'Add product' });
    fireEvent.click(screen.getByRole('button', { name: 'Add product' }));
    let dialog = screen.getByRole('dialog', { name: 'Add product' });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await within(dialog).findByText('Enter a product name')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText(/Product name/), { target: { value: 'Soap' } });
    fireEvent.change(within(dialog).getByLabelText(/SKU/), { target: { value: 'SOAP-NEW' } });
    fireEvent.change(within(dialog).getByLabelText(/Purchase cost/), { target: { value: '7.01' } });
    fireEvent.change(within(dialog).getByLabelText(/Selling price/), { target: { value: '9.25' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('Product saved.')).toBeTruthy();
    expect(await screen.findByRole('heading', { name: 'Soap' })).toBeTruthy();
    const create = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, opt]) => String(url).endsWith('/products') && opt?.method === 'POST',
      )!;
    expect(JSON.parse(String(create[1]?.body))).toMatchObject({
      sellingPriceMinor: '925',
      purchaseCostMinor: '701',
    });
    fireEvent.click(screen.getByRole('button', { name: 'Table' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Edit Soap' }));
    dialog = screen.getByRole('dialog', { name: 'Edit product' });
    fireEvent.change(within(dialog).getByLabelText('Product name'), {
      target: { value: 'Soap updated' },
    });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await screen.findByRole('button', { name: 'Soap updated' })).toBeTruthy();
  });
  it('creates categories and suppliers through their real API clients', async () => {
    setup('/categories');
    fireEvent.click(await screen.findByRole('button', { name: 'Add category' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Dairy' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save category' }));
    expect(await screen.findByText('Dairy')).toBeTruthy();
    fireEvent.click(screen.getByRole('link', { name: 'Suppliers' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Add supplier' }));
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Local wholesaler' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save supplier' }));
    expect(await screen.findByText('Local wholesaler')).toBeTruthy();
  });
  it('shows API failures and retries without fixture fallback', async () => {
    failProducts = true;
    setup();
    expect(await screen.findByText('Database request failed')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Rice 25kg' })).toBeNull();
    failProducts = false;
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('heading', { name: 'Rice 25kg' })).toBeTruthy();
  });
  it('limits cashier navigation and mutation controls', async () => {
    role = 'CASHIER';
    products = products.map(({ purchaseCostMinor: _cost, ...p }) => p);
    setup();
    await screen.findByRole('heading', { name: 'Rice 25kg' });
    expect(screen.queryByRole('button', { name: 'Add product' })).toBeNull();
    expect(screen.queryByRole('link', { name: 'Suppliers' })).toBeNull();
  });
  it('keeps mobile navigation functional and requires an explicit checkout confirmation', async () => {
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Increase Rice 25kg' }));
    expect(screen.getAllByText('D 4,400.00').length).toBeGreaterThan(0);
    expect(
      (screen.getByRole('button', { name: 'Confirm checkout' }) as HTMLButtonElement).disabled,
    ).toBe(false);
    const toggle = screen.getByRole('button', { name: 'Open navigation' });
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    fireEvent.click(screen.getByRole('button', { name: 'Close navigation', expanded: true }));
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
  });
  it('submits a price-free checkout with a retry key and displays a printable receipt', async () => {
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.change(screen.getByLabelText('Amount received (GMD)'), { target: { value: '2500' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
    const receipt = await screen.findByRole('dialog', { name: 'Sale receipt' });
    expect(within(receipt).getByText('SF-TEST')).toBeTruthy();
    expect(within(receipt).getByText('D 300.00')).toBeTruthy();
    expect(within(receipt).getByRole('button', { name: 'Print / Save as PDF' })).toBeTruthy();
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
      )!;
    const body = JSON.parse(String(call[1]?.body));
    expect(body.items).toEqual([{ productId: product.id, quantity: '1' }]);
    expect(body.amountReceived).toBe('2500');
    expect(body.amountReceivedMinor).toBeUndefined();
    expect(body.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
    expect(body.totalMinor).toBeUndefined();
    expect(body.items[0].unitPriceMinor).toBeUndefined();
    fireEvent.click(within(receipt).getByRole('button', { name: 'Close' }));
    expect(screen.getByText('Start with a product')).toBeTruthy();
  });
  it.each([
    ['475000', '', '0'],
    ['475000', '5000', '25000'],
    ['39050', '400', '950'],
    ['39000', '390', '0'],
  ])('checks cash payment for price %s and input %s', async (price, amount, change) => {
    products = [{ ...product, sellingPriceMinor: price }];
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    const posts = () =>
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
        );
    expect(posts()).toHaveLength(0);
    if (amount)
      fireEvent.change(screen.getByLabelText('Amount received (GMD)'), {
        target: { value: amount },
      });
    else expect(screen.getByText('Exact payment — ' + formatMoney(price))).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
    const receipt = await screen.findByRole('dialog', { name: 'Sale receipt' });
    expect(within(receipt).getAllByText(formatMoney(change)).length).toBeGreaterThan(0);
    expect(
      screen.getByText('Sale completed successfully. Your receipt is ready.').getAttribute('role'),
    ).toBe('status');
    expect(recordedSales[0].changeMinor).toBe(change);
    const body = JSON.parse(String(posts()[0][1]?.body));
    if (!amount) {
      expect(body.exactPayment).toBe(true);
      expect(body.amountReceived).toBeUndefined();
      expect(body.amountReceivedMinor).toBeUndefined();
      expect(recordedSales[0].amountReceivedMinor).toBe(price);
    }
    expect(body.totalMinor).toBeUndefined();
  });
  it('rejects D4700 for a D4750 sale and preserves the cart', async () => {
    products = [{ ...product, sellingPriceMinor: '475000' }];
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.change(screen.getByLabelText('Amount received (GMD)'), { target: { value: '4700' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
    expect((await screen.findByRole('alert')).textContent).toContain('below the total');
    expect(screen.getByLabelText('Quantity for Rice 25kg')).toBeTruthy();
    expect(recordedSales).toHaveLength(0);
  });
  it('blocks double-clicks while saving and keeps the cart until success', async () => {
    let finish!: () => void;
    saleGate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    const button = screen.getByRole('button', { name: 'Confirm checkout' });
    fireEvent.click(button);
    fireEvent.click(button);
    await screen.findByRole('button', { name: 'Recording sale…' });
    expect(screen.getByLabelText('Quantity for Rice 25kg')).toBeTruthy();
    expect(
      vi
        .mocked(fetch)
        .mock.calls.filter(
          ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
        ),
    ).toHaveLength(1);
    finish();
    await screen.findByRole('dialog', { name: 'Sale receipt' });
    expect(recordedSales).toHaveLength(1);
    expect(screen.queryByLabelText('Quantity for Rice 25kg')).toBeNull();
  });
  it.each([409, 503])(
    'preserves the cart after backend failure %s and retries safely',
    async (status) => {
      saleFailure = status;
      setup('/pos');
      fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
      fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
      await screen.findByText('Sale could not be saved');
      expect(screen.getByLabelText('Quantity for Rice 25kg')).toBeTruthy();
      expect(recordedSales).toHaveLength(0);
      const posts = () =>
        vi
          .mocked(fetch)
          .mock.calls.filter(
            ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
          );
      const first = JSON.parse(String(posts()[0][1]?.body));
      saleFailure = undefined;
      fireEvent.click(
        await screen.findByRole('button', {
          name: status === 503 ? 'Retry this checkout' : 'Confirm checkout',
        }),
      );
      await screen.findByRole('dialog', { name: 'Sale receipt' });
      expect(recordedSales).toHaveLength(1);
      if (status === 503) expect(JSON.parse(String(posts()[1][1]?.body))).toEqual(first);
    },
  );
  it.each(['BANK_TRANSFER', 'MOBILE_MONEY', 'CARD'])(
    'does not infer exact payment for %s',
    async (method) => {
      setup('/pos');
      fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
      fireEvent.change(screen.getByLabelText('Payment method'), { target: { value: method } });
      expect(screen.queryByText(/Exact payment —/)).toBeNull();
      expect(screen.getByLabelText('I confirmed the payment was received')).toBeTruthy();
      expect(screen.getByLabelText('Payment reference')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
      expect(screen.getByRole('alert').textContent).toContain('valid GMD amount');
      expect(recordedSales).toHaveLength(0);
    },
  );
  it('calculates fractional cart quantities in exact minor units', async () => {
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.change(screen.getByLabelText('Quantity for Rice 25kg'), { target: { value: '0' } });
    fireEvent.change(screen.getByLabelText('Quantity for Rice 25kg'), { target: { value: '0.' } });
    fireEvent.change(screen.getByLabelText('Quantity for Rice 25kg'), {
      target: { value: '0.125' },
    });
    expect(screen.getAllByText('D 275.00').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Amount received (GMD)'), { target: { value: '300' } });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
    await waitFor(() =>
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
          ),
      ).toBe(true),
    );
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
      )!;
    expect(JSON.parse(String(call[1]?.body)).items[0].quantity).toBe('0.125');
  });
  it('formats values beyond Number precision and validates BIGINT input bounds', () => {
    expect(formatMoney('9223372036854775807')).toBe('D 92,233,720,368,547,758.07');
    expect(parseMoneyInput('92233720368547758.07')).toBe('9223372036854775807');
    expect(() => parseMoneyInput('92233720368547758.08')).toThrow();
    expect(() => parseMoneyInput('1.001')).toThrow();
    expect(parseMoneyInput('0.29')).toBe('29');
  });
  it('creates a product without a manual SKU and displays the generated code', async () => {
    setup();
    fireEvent.click(await screen.findByRole('button', { name: 'Add product' }));
    const dialog = screen.getByRole('dialog', { name: 'Add product' });
    expect(within(dialog).getByPlaceholderText('Automatically generated')).toBeTruthy();
    fireEvent.change(within(dialog).getByLabelText('Product name'), {
      target: { value: 'Automatic product' },
    });
    fireEvent.change(within(dialog).getByLabelText(/Purchase cost/), { target: { value: '1' } });
    fireEvent.change(within(dialog).getByLabelText(/Selling price/), { target: { value: '2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save product' }));
    expect(await screen.findByText('PRD-000001')).toBeTruthy();
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => String(url).endsWith('/products') && options?.method === 'POST',
      )!;
    expect(JSON.parse(String(call[1]?.body)).sku).toBeUndefined();
  });
  it.each(['390', '390.5', '390.50', '1000', '1000.75', '0.01'])(
    'allows natural payment input %s',
    async (input) => {
      products = [{ ...product, sellingPriceMinor: '1' }];
      setup('/pos');
      fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
      fireEvent.change(screen.getByLabelText('Amount received (GMD)'), {
        target: { value: input },
      });
      fireEvent.keyDown(screen.getByLabelText('Amount received (GMD)'), {
        key: 'Enter',
        code: 'Enter',
      });
      const receipt = await screen.findByRole('dialog', { name: 'Sale receipt' });
      expect(
        within(receipt).getAllByText(formatMoney(parseMoneyInput(input))).length,
      ).toBeGreaterThan(0);
    },
  );
  it.each(['-1', '390.501', 'abc'])(
    'rejects invalid payment %s without sending a checkout',
    async (input) => {
      products = [{ ...product, sellingPriceMinor: '1' }];
      setup('/pos');
      fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
      fireEvent.change(screen.getByLabelText('Amount received (GMD)'), {
        target: { value: input },
      });
      fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
      expect(screen.getByRole('alert')).toBeTruthy();
      expect(
        vi
          .mocked(fetch)
          .mock.calls.some(
            ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
          ),
      ).toBe(false);
    },
  );
  it('checks out D661.25 with D700 by keyboard, then restores the persisted sale after remount', async () => {
    products = [{ ...product, sellingPriceMinor: '52900' }];
    const mounted = setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.change(screen.getByLabelText('Quantity for Rice 25kg'), {
      target: { value: '1.25' },
    });
    fireEvent.change(screen.getByLabelText('Amount received (GMD)'), { target: { value: '700' } });
    expect(screen.getByText('Change: D 38.75')).toBeTruthy();
    fireEvent.keyDown(screen.getByLabelText('Amount received (GMD)'), {
      key: 'Enter',
      code: 'Enter',
    });
    const receipt = await screen.findByRole('dialog', { name: 'Sale receipt' });
    expect(within(receipt).getByText('D 38.75')).toBeTruthy();
    expect(within(receipt).getAllByText('D 661.25').length).toBeGreaterThan(0);
    mounted.unmount();
    setup('/sales');
    expect(await screen.findByText('D 661.25')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View / print' }));
    expect(
      within(await screen.findByRole('dialog', { name: 'Sale receipt' })).getByText('D 38.75'),
    ).toBeTruthy();
  });
  it('preserves all quantity digits beyond Number precision', async () => {
    expect(parseQuantityInput('123456789012345.125')).toBe(123456789012345125n);
    expect(quantityInputValue(123456789012345125n)).toBe('123456789012345.125');
    products = [{ ...product, sellingPriceMinor: '1', quantity: '999999999999999.999' }];
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    fireEvent.change(screen.getByLabelText('Quantity for Rice 25kg'), {
      target: { value: '123456789012345.125' },
    });
    expect(screen.getAllByText('D 1,234,567,890,123.45').length).toBeGreaterThan(0);
    fireEvent.change(screen.getByLabelText('Amount received (GMD)'), {
      target: { value: '2000000000000' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Confirm checkout' }));
    await screen.findByRole('dialog', { name: 'Sale receipt' });
    const call = vi
      .mocked(fetch)
      .mock.calls.find(
        ([url, options]) => String(url).endsWith('/sales') && options?.method === 'POST',
      )!;
    expect(JSON.parse(String(call[1]?.body)).items[0].quantity).toBe('123456789012345.125');
  });
  it('can sell remaining stock below one unit', async () => {
    products = [{ ...product, sellingPriceMinor: '101', quantity: '0.125' }];
    setup('/pos');
    fireEvent.click(await screen.findByRole('button', { name: /Rice 25kg/ }));
    expect((screen.getByLabelText('Quantity for Rice 25kg') as HTMLInputElement).value).toBe(
      '0.125',
    );
    expect(screen.getAllByText('D 0.13').length).toBeGreaterThan(0);
  });
});
