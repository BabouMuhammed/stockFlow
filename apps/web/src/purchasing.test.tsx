import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { request } from './api';
import {
  PurchaseForm,
  ReceiptDetail,
  SupplierOverview,
  receiptPreview,
  type PurchaseReceipt,
} from './features/purchasing';

vi.mock('./features/session', () => ({
  useSession: () => ({
    session: { business: { id: 'business' }, user: { id: 'owner', role: 'OWNER' } },
  }),
}));
vi.mock('./api', async (original) => ({
  ...(await original<typeof import('./api')>()),
  request: vi.fn(),
}));
const mocked = vi.mocked(request);
let receipt: PurchaseReceipt;
function setup(node: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(<QueryClientProvider client={client}>{node}</QueryClientProvider>);
}
beforeEach(() => {
  mocked.mockReset();
  HTMLDialogElement.prototype.showModal = function () {
    this.setAttribute('open', '');
  };
  HTMLDialogElement.prototype.close = function () {
    this.removeAttribute('open');
  };
  receipt = {
    id: 'receipt',
    reference: 'INV-1',
    internalReference: null,
    supplierInvoiceReference: null,
    supplierId: 'supplier',
    supplierName: 'ABC Distributors',
    receiptDate: '2026-01-01',
    createdAt: '2026-01-01',
    notes: '',
    settlementKnown: true,
    totalMinor: '950000',
    paidMinor: '0',
    outstandingMinor: '950000',
    paymentStatus: 'UNPAID',
    items: [
      {
        productName: 'Cooking oil',
        quantity: '20',
        unitCostMinor: '15000',
        lineTotalMinor: '300000',
      },
    ],
    payments: [],
  };
  mocked.mockImplementation(async (path, options) => {
    if (options?.method === 'POST') {
      if (path === '/inventory/receipts')
        return {
          ...receipt,
          id: 'created',
          reference: 'SR-000001',
          internalReference: 'SR-000001',
          supplierInvoiceReference:
            JSON.parse(String(options.body)).supplierInvoiceReference ?? null,
        } as never;
      return { id: 'created' } as never;
    }
    if (path === '/suppliers')
      return [{ id: 'supplier', name: 'ABC Distributors', isActive: true }] as never;
    if (path.startsWith('/products?'))
      return {
        data: [
          { id: 'oil', name: 'Cooking oil', sku: 'OIL' },
          { id: 'rice', name: 'Rice', sku: 'RICE' },
        ],
        total: 2,
      } as never;
    if (path.startsWith('/inventory/receipts/')) return receipt as never;
    if (path.startsWith('/inventory/receipts?')) return { data: [receipt], total: 1 } as never;
    if (path.startsWith('/suppliers/supplier/financial'))
      return {
        supplier: { name: 'ABC Distributors', phone: '1234567' },
        purchaseCount: '1',
        totalPurchaseMinor: '950000',
        totalSupplierPaidMinor: '0',
        outstandingSupplierMinor: '950000',
        unreconciledPurchases: '1',
        unreconciledPurchaseMinor: '100000',
        payments: { data: [], total: 0 },
      } as never;
    throw new Error('Unexpected path: ' + path);
  });
});
afterEach(cleanup);
async function fillReceipt() {
  await screen.findByRole('option', { name: 'ABC Distributors' });
  fireEvent.change(screen.getByLabelText('Supplier'), { target: { value: 'supplier' } });
  fireEvent.change(screen.getByLabelText('Supplier invoice / delivery note number (optional)'), {
    target: { value: 'INV-DEMO' },
  });
  fireEvent.change(screen.getByLabelText('Product 1'), { target: { value: 'oil' } });
  fireEvent.change(screen.getByLabelText('Quantity 1'), { target: { value: '20' } });
  fireEvent.change(screen.getByLabelText('Buying price 1 (GMD)'), { target: { value: '150' } });
}
describe('purchasing screens', () => {
  it('previews exact fractional quantities without accepting extra currency decimals', () => {
    expect(
      receiptPreview([
        { quantity: '0.5', cost: '1.01' },
        { quantity: '1', cost: '0.20' },
      ]).total,
    ).toBe(71n);
    expect(() => receiptPreview([{ quantity: '1', cost: '1.001' }])).toThrow();
    expect(() => receiptPreview([{ quantity: '0', cost: '1' }])).toThrow();
  });
  it('builds one multi-product supplier transaction with visible exact totals', async () => {
    const closed = vi.fn();
    setup(<PurchaseForm onClose={closed} />);
    await fillReceipt();
    fireEvent.click(screen.getByRole('button', { name: 'Add another product' }));
    fireEvent.change(screen.getByLabelText('Product 2'), { target: { value: 'rice' } });
    fireEvent.change(screen.getByLabelText('Quantity 2'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Buying price 2 (GMD)'), { target: { value: '450' } });
    expect(screen.getByText('D 7,500.00')).toBeTruthy();
    fireEvent.submit(
      screen.getByRole('button', { name: 'Confirm stock receipt' }).closest('form')!,
    );
    await waitFor(() => expect(closed).toHaveBeenCalledOnce());
    const call = mocked.mock.calls.find(([, o]) => o?.method === 'POST')!;
    const body = JSON.parse(String(call[1]?.body));
    expect(body).toMatchObject({
      supplierId: 'supplier',
      supplierInvoiceReference: 'INV-DEMO',
      items: [
        { productId: 'oil', quantity: '20', unitCostMinor: '15000' },
        { productId: 'rice', quantity: '10', unitCostMinor: '45000' },
      ],
    });
    expect(body.totalMinor).toBeUndefined();
    expect(body.reference).toBeUndefined();
    expect(body.internalReference).toBeUndefined();
  });
  it('receives stock with no supplier document and exposes the backend-generated code after saving', async () => {
    const saved = vi.fn();
    setup(<PurchaseForm onClose={vi.fn()} onSaved={saved} />);
    await fillReceipt();
    expect((screen.getByLabelText('StockFlow receipt number') as HTMLInputElement).value).toBe(
      'Automatically generated',
    );
    const invoice = screen.getByLabelText(
      'Supplier invoice / delivery note number (optional)',
    ) as HTMLInputElement;
    expect(invoice.required).toBe(false);
    fireEvent.change(invoice, { target: { value: '' } });
    fireEvent.submit(
      screen.getByRole('button', { name: 'Confirm stock receipt' }).closest('form')!,
    );
    await waitFor(() => expect(saved).toHaveBeenCalledOnce());
    expect(saved.mock.calls[0][0]).toMatchObject({
      reference: 'SR-000001',
      internalReference: 'SR-000001',
      supplierInvoiceReference: null,
    });
    const call = mocked.mock.calls.find(([, o]) => o?.method === 'POST')!;
    expect(JSON.parse(String(call[1]?.body)).supplierInvoiceReference).toBeUndefined();
  });
  it('blocks duplicate submissions while preserving the form on backend failure', async () => {
    setup(<PurchaseForm onClose={vi.fn()} />);
    await fillReceipt();
    const base = mocked.getMockImplementation()!;
    let reject!: (error: Error) => void;
    const gate = new Promise<never>((_resolve, fail) => {
      reject = fail;
    });
    mocked.mockImplementation((path, options) =>
      options?.method === 'POST' ? gate : base(path, options),
    );
    const form = screen.getByRole('button', { name: 'Confirm stock receipt' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(mocked.mock.calls.filter(([, o]) => o?.method === 'POST')).toHaveLength(1),
    );
    reject(new Error('Receipt could not be saved'));
    await screen.findByText('Receipt could not be saved');
    expect((screen.getByLabelText('Buying price 1 (GMD)') as HTMLInputElement).value).toBe('150');
    expect((screen.getByLabelText('Quantity 1') as HTMLInputElement).value).toBe('20');
  });
  it('records supplier payments only with explicit confirmation, using natural money input', async () => {
    setup(<ReceiptDetail id="receipt" onClose={vi.fn()} />);
    await screen.findByLabelText('Payment amount (GMD)');
    fireEvent.change(screen.getByLabelText('Payment amount (GMD)'), { target: { value: '390.5' } });
    fireEvent.click(
      screen.getByLabelText('I confirm this money was actually paid to the supplier.'),
    );
    fireEvent.submit(
      screen.getByRole('button', { name: 'Confirm supplier payment' }).closest('form')!,
    );
    await screen.findByText('Supplier settlement saved.');
    const call = mocked.mock.calls.find(
      ([p, o]) => p.endsWith('/payments') && o?.method === 'POST',
    )!;
    expect(JSON.parse(String(call[1]?.body))).toMatchObject({
      amountMinor: '39050',
      confirmed: true,
      method: 'CASH',
    });
  });
  it('labels historical unknown balances and exposes deliberate owner reconciliation', async () => {
    receipt = {
      ...receipt,
      settlementKnown: false,
      outstandingMinor: null,
      paymentStatus: 'UNRECONCILED',
    };
    setup(<ReceiptDetail id="receipt" onClose={vi.fn()} />);
    await screen.findByText(/Historical payment history is unverified/);
    fireEvent.click(screen.getByRole('button', { name: 'Reconcile history' }));
    expect(
      screen.getByLabelText(
        'I checked the original records and recorded all payments for this purchase.',
      ),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Confirm reconciled history' })).toBeTruthy();
  });
  it('opens supplier financial overview and receipt details with separate accessible dialog labels', async () => {
    setup(<SupplierOverview id="supplier" onClose={vi.fn()} />);
    await screen.findByText('Current verified debt');
    expect(screen.getByText(/Unreconciled history is excluded/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'View INV-1' }));
    await screen.findByRole('heading', { name: 'Purchase INV-1' });
    expect(
      new Set(screen.getAllByRole('dialog').map((d) => d.getAttribute('aria-labelledby'))).size,
    ).toBe(2);
  });
});
