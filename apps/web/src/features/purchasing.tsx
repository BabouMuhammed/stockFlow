import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney, MAX_MINOR, parseMoneyInput, parseQuantityInput } from '@stockflow/shared';
import { request } from '../api';
import { Dialog, Notice } from '../components/ui';
import { StatusBadge, SummaryCard } from '../components/retail';
import {
  DataTable,
  ErrorMessage,
  Feedback,
  Field,
  Pager,
  paymentOptions,
  useData,
  useDebounced,
  type Page,
} from './workflows';
import { useSession } from './session';
import type { ProductList } from './catalogue';

export type SupplierSettlement = {
  id: string;
  receiptId: string;
  amountMinor: string;
  date: string;
  method: string;
  reference?: string | null;
  notes: string;
  reversalOfId: string | null;
  receipt?: { reference: string };
};
export type PurchaseReceipt = {
  id: string;
  reference: string;
  internalReference: string | null;
  supplierInvoiceReference: string | null;
  supplierId: string | null;
  supplierName: string | null;
  receiptDate: string;
  createdAt: string;
  notes: string;
  settlementKnown: boolean;
  totalMinor: string;
  paidMinor: string;
  outstandingMinor: string | null;
  paymentStatus: string;
  items: { productName: string; quantity: string; unitCostMinor: string; lineTotalMinor: string }[];
  payments: SupplierSettlement[];
};
const today = () => new Date().toISOString().slice(0, 10);
const dateLabel = (value: string) =>
  new Date(value).toLocaleDateString('en-GB', { timeZone: 'Africa/Banjul' });
export function PurchaseStatus({ status }: { status: string }) {
  return (
    <StatusBadge tone={status === 'PAID' ? 'success' : 'neutral'}>
      {status.replaceAll('_', ' ')}
    </StatusBadge>
  );
}
export function PurchaseTable({
  receipts,
  onOpen,
}: {
  receipts: PurchaseReceipt[];
  onOpen: (id: string) => void;
}) {
  return (
    <DataTable
      columns={[
        'StockFlow receipt / original reference',
        'Supplier invoice / delivery note',
        'Supplier',
        'Received',
        'Products',
        'Purchase total',
        'Recorded paid',
        'Outstanding',
        'Status',
        'Details',
      ]}
      rows={receipts.map((r) => [
        r.reference,
        r.supplierInvoiceReference ??
          (r.internalReference ? 'Not provided' : 'Not separately recorded'),
        r.supplierName ?? 'Not recorded',
        dateLabel(r.receiptDate ?? r.createdAt),
        r.items.length,
        formatMoney(r.totalMinor),
        formatMoney(r.paidMinor),
        r.outstandingMinor === null ? 'Unreconciled' : formatMoney(r.outstandingMinor),
        <PurchaseStatus status={r.paymentStatus} />,
        <button className="quiet-action" onClick={() => onOpen(r.id)}>
          View {r.reference}
        </button>,
      ])}
      empty="No stock receipts found"
    />
  );
}
type Line = { key: string; productId: string; name: string; quantity: string; cost: string };
const newLine = (): Line => ({
  key: crypto.randomUUID(),
  productId: '',
  name: '',
  quantity: '1',
  cost: '',
});
export function receiptPreview(lines: Pick<Line, 'quantity' | 'cost'>[]) {
  const totals = lines.map((i) => {
    const quantity = parseQuantityInput(i.quantity);
    if (quantity === 0n) throw new Error('Quantity must be positive');
    const value = (BigInt(parseMoneyInput(i.cost)) * quantity + 500n) / 1000n;
    if (value > MAX_MINOR) throw new Error('Purchase amount exceeds the supported range');
    return value;
  });
  const total = totals.reduce((s, v) => s + v, 0n);
  if (total > MAX_MINOR) throw new Error('Purchase total exceeds the supported range');
  return { totals, total };
}
export function PurchaseForm({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (receipt: PurchaseReceipt) => void;
}) {
  const client = useQueryClient(),
    key = useRef(crypto.randomUUID()),
    busy = useRef(false);
  const [lines, setLines] = useState<Line[]>([newLine()]),
    [search, setSearch] = useState(''),
    [error, setError] = useState('');
  const products = useData<ProductList>(
    'stock-products',
    '/products?active=true&limit=100&search=' + encodeURIComponent(useDebounced(search)),
  );
  const suppliers = useData<{ id: string; name: string; isActive: boolean }[]>(
    'suppliers',
    '/suppliers',
  );
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      request<PurchaseReceipt>('/inventory/receipts', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async (receipt) => {
      await client.invalidateQueries();
      onClose();
      onSaved?.(receipt);
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const patch = (key: string, changes: Partial<Line>) =>
    setLines((rows) => rows.map((r) => (r.key === key ? { ...r, ...changes } : r)));
  let preview: ReturnType<typeof receiptPreview> | undefined;
  try {
    preview = receiptPreview(lines);
  } catch {
    /* Incomplete input is allowed while typing. */
  }
  return (
    <Dialog
      title="Receive stock"
      onClose={() => {
        if (!busy.current) onClose();
      }}
    >
      <form
        className="settings-form purchase-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (busy.current) return;
          setError('');
          try {
            receiptPreview(lines);
            if (new Set(lines.map((l) => l.productId)).size !== lines.length)
              throw new Error('Combine quantities instead of selecting the same product twice');
            const data = new FormData(e.currentTarget);
            const body = {
              supplierId: data.get('supplierId'),
              ...(String(data.get('supplierInvoiceReference') ?? '').trim()
                ? { supplierInvoiceReference: String(data.get('supplierInvoiceReference')).trim() }
                : {}),
              receivedDate: data.get('receivedDate'),
              notes: data.get('notes'),
              ...(data.get('repeatReferenceReason')
                ? { repeatReferenceReason: data.get('repeatReferenceReason') }
                : {}),
              items: lines.map((l) => ({
                productId: l.productId,
                quantity: l.quantity,
                unitCostMinor: parseMoneyInput(l.cost),
              })),
              idempotencyKey: key.current,
            };
            busy.current = true;
            mutation.mutate(body);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Check your values');
          }
        }}
      >
        <Field label="Supplier">
          <select name="supplierId" required>
            <option value="">Select supplier</option>
            {(suppliers.data ?? [])
              .filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </Field>
        <Feedback query={suppliers} />
        <Field label="StockFlow receipt number">
          <input value="Automatically generated" readOnly />
        </Field>
        <Field label="Supplier invoice / delivery note number (optional)">
          <input
            name="supplierInvoiceReference"
            maxLength={120}
            aria-describedby="supplier-document-help"
          />
        </Field>
        <small id="supplier-document-help">
          Enter the number printed on the supplier’s invoice or delivery note. Leave empty if none
          was provided.
        </small>
        <Field label="Receipt date">
          <input name="receivedDate" type="date" defaultValue={today()} required />
        </Field>
        <Field label="Find products" value={search} onChange={setSearch} required={false} />
        <Feedback query={products} />
        <fieldset className="purchase-lines" disabled={mutation.isPending}>
          <legend>Products received</legend>
          {lines.map((line, index) => (
            <div className="purchase-line" key={line.key}>
              <Field label={'Product ' + (index + 1)}>
                <select
                  value={line.productId}
                  required
                  onChange={(e) => {
                    const product = products.data?.data.find((p) => p.id === e.target.value);
                    patch(line.key, { productId: e.target.value, name: product?.name ?? '' });
                  }}
                >
                  <option value="">Select product</option>
                  {line.productId && !products.data?.data.some((p) => p.id === line.productId) && (
                    <option value={line.productId}>{line.name}</option>
                  )}
                  {(products.data?.data ?? []).map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} · {p.sku}
                    </option>
                  ))}
                </select>
              </Field>
              <Field
                label={'Quantity ' + (index + 1)}
                value={line.quantity}
                onChange={(v) => patch(line.key, { quantity: v })}
                type="number"
              />
              <Field
                label={'Buying price ' + (index + 1) + ' (GMD)'}
                value={line.cost}
                onChange={(v) => patch(line.key, { cost: v })}
              />
              <p>
                Line total: <strong>{preview ? formatMoney(preview.totals[index]) : '—'}</strong>
              </p>
              <button
                type="button"
                className="quiet-action"
                disabled={lines.length === 1}
                onClick={() => setLines((r) => r.filter((v) => v.key !== line.key))}
              >
                Remove product {index + 1}
              </button>
            </div>
          ))}
          <button
            type="button"
            className="button secondary"
            disabled={lines.length >= 100}
            onClick={() => setLines((r) => [...r, newLine()])}
          >
            Add another product
          </button>
        </fieldset>
        <p className="purchase-total">
          Purchase total: <strong>{preview ? formatMoney(preview.total) : '—'}</strong>
        </p>
        <Field label="Notes (optional)" name="notes" required={false} />
        <Field
          label="Repeat supplier invoice / partial delivery reason (only for a document already received)"
          name="repeatReferenceReason"
          required={false}
        />
        <Notice>
          Confirming adds these quantities to stock. Record money actually paid from the saved
          receipt; no operating expense is created.
        </Notice>
        {error && (
          <p role="alert" className="form-alert">
            {error}
          </p>
        )}
        <ErrorMessage error={mutation.error} />
        <button className="button primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Receiving…' : 'Confirm stock receipt'}
        </button>
      </form>
    </Dialog>
  );
}

export function ReceiptDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useData<PurchaseReceipt>('receipt-detail', '/inventory/receipts/' + id);
  const client = useQueryClient(),
    { session } = useSession(),
    busy = useRef(false);
  const key = useRef(crypto.randomUUID());
  const [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [action, setAction] = useState<'pay' | 'reconcile' | string>('pay');
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      request(path, { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      key.current = crypto.randomUUID();
      setSaved('Supplier settlement saved.');
      await client.invalidateQueries();
    },
    onSettled: () => {
      busy.current = false;
    },
  });
  const r = query.data;
  const reversed = new Set(r?.payments.filter((p) => p.reversalOfId).map((p) => p.reversalOfId));
  return (
    <Dialog
      title={r ? 'Purchase ' + r.reference : 'Purchase details'}
      onClose={() => {
        if (!busy.current) onClose();
      }}
    >
      <Feedback query={query} />
      {saved && <Notice>{saved}</Notice>}
      {r && (
        <>
          <p>
            {r.supplierName ?? 'Supplier not recorded'} · {dateLabel(r.receiptDate)} ·{' '}
            <PurchaseStatus status={r.paymentStatus} />
          </p>
          {r.notes && <p>{r.notes}</p>}
          <p>
            StockFlow receipt: <strong>{r.reference}</strong>
            {!r.internalReference && ' (original reference)'}
            {' · '}Supplier invoice / delivery note:{' '}
            {r.supplierInvoiceReference ??
              (r.internalReference ? 'Not provided' : 'Not separately recorded')}
          </p>
          <DataTable
            columns={['Product', 'Quantity', 'Unit cost', 'Line total']}
            rows={r.items.map((i) => [
              i.productName,
              i.quantity,
              formatMoney(i.unitCostMinor),
              formatMoney(i.lineTotalMinor),
            ])}
          />
          <p>
            Total: <strong>{formatMoney(r.totalMinor)}</strong> · Recorded paid:{' '}
            {formatMoney(r.paidMinor)} · Outstanding:{' '}
            {r.outstandingMinor === null ? 'Unreconciled' : formatMoney(r.outstandingMinor)}
          </p>
          {!r.settlementKnown && (
            <Notice>
              Historical payment history is unverified. This purchase is excluded from confirmed
              supplier debt. Record known payments before an owner confirms reconciliation.
            </Notice>
          )}
          <h3>Payment history</h3>
          <DataTable
            columns={['Date', 'Method', 'Amount', 'Reference / notes', 'Action']}
            rows={r.payments.map((p) => [
              dateLabel(p.date),
              p.method.replaceAll('_', ' '),
              (p.reversalOfId ? 'Reversal ' : '') + formatMoney(p.amountMinor),
              [p.reference, p.notes].filter(Boolean).join(' · '),
              !p.reversalOfId && !reversed.has(p.id) ? (
                <button
                  className="quiet-action"
                  onClick={() => {
                    setAction(p.id);
                    setError('');
                  }}
                >
                  Reverse entry
                </button>
              ) : (
                'Retained for audit'
              ),
            ])}
            empty="No supplier payments recorded"
          />
          {r.supplierId && (
            <>
              <div className="workflow-links">
                <button
                  className="button secondary"
                  onClick={() => {
                    setAction('pay');
                    setError('');
                  }}
                >
                  Record payment
                </button>
                {!r.settlementKnown && session?.user.role === 'OWNER' && (
                  <button
                    className="button secondary"
                    onClick={() => {
                      setAction('reconcile');
                      setError('');
                    }}
                  >
                    Reconcile history
                  </button>
                )}
              </div>
              <form
                key={action + saved}
                className="settings-form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (busy.current) return;
                  setError('');
                  setSaved('');
                  const data = new FormData(e.currentTarget);
                  try {
                    let path: string, body: unknown;
                    if (action === 'reconcile') {
                      path = '/inventory/receipts/' + id + '/reconcile';
                      body = {
                        reason: data.get('notes'),
                        confirmAllPaymentsRecorded: data.get('confirmed') === 'on',
                        idempotencyKey: key.current,
                      };
                    } else if (action !== 'pay') {
                      path = '/inventory/payments/' + action + '/reverse';
                      body = {
                        reason: data.get('notes'),
                        date: data.get('date'),
                        confirmed: data.get('confirmed') === 'on',
                        idempotencyKey: key.current,
                      };
                    } else {
                      path = '/inventory/receipts/' + id + '/payments';
                      body = {
                        amountMinor: parseMoneyInput(String(data.get('amount'))),
                        date: data.get('date'),
                        method: data.get('method'),
                        reference: data.get('reference'),
                        notes: data.get('notes'),
                        confirmed: data.get('confirmed') === 'on',
                        idempotencyKey: key.current,
                      };
                    }
                    busy.current = true;
                    mutation.mutate({ path, body });
                  } catch (err) {
                    setError(err instanceof Error ? err.message : 'Check payment details');
                  }
                }}
              >
                <h3>
                  {action === 'pay'
                    ? 'Record supplier payment'
                    : action === 'reconcile'
                      ? 'Confirm historical reconciliation'
                      : 'Reverse a payment entry'}
                </h3>
                {action === 'pay' && (
                  <>
                    <Field label="Payment amount (GMD)" name="amount" />
                    <Field label="Payment method">
                      <select name="method">{paymentOptions}</select>
                    </Field>
                    <Field label="Payment reference" name="reference" required={false} />
                  </>
                )}
                {action !== 'reconcile' && (
                  <Field label="Payment / reversal date">
                    <input name="date" type="date" defaultValue={today()} required />
                  </Field>
                )}
                <Field
                  label={action === 'pay' ? 'Notes (optional)' : 'Reason'}
                  name="notes"
                  required={action !== 'pay'}
                />
                <label className="check-field">
                  <input type="checkbox" name="confirmed" required />
                  {action === 'pay'
                    ? 'I confirm this money was actually paid to the supplier.'
                    : action === 'reconcile'
                      ? 'I checked the original records and recorded all payments for this purchase.'
                      : 'I confirm this entry is incorrect and should be reversed. This does not send or recover money.'}
                </label>
                {error && (
                  <p className="form-alert" role="alert">
                    {error}
                  </p>
                )}
                <ErrorMessage error={mutation.error} />
                <button className="button primary" disabled={mutation.isPending}>
                  {mutation.isPending
                    ? 'Saving…'
                    : action === 'pay'
                      ? 'Confirm supplier payment'
                      : action === 'reconcile'
                        ? 'Confirm reconciled history'
                        : 'Confirm reversal'}
                </button>
              </form>
            </>
          )}
        </>
      )}
    </Dialog>
  );
}

type SupplierFinancial = {
  supplier: {
    name: string;
    phone?: string;
    email?: string;
    contactPerson?: string;
    address?: string;
    notes?: string;
  };
  purchaseCount: string;
  totalPurchaseMinor: string;
  totalSupplierPaidMinor: string;
  outstandingSupplierMinor: string;
  unreconciledPurchases: string;
  unreconciledPurchaseMinor: string;
  payments: Page<SupplierSettlement>;
};
export function SupplierOverview({ id, onClose }: { id: string; onClose: () => void }) {
  const [page, setPage] = useState(1),
    [paymentPage, setPaymentPage] = useState(1),
    [opened, setOpened] = useState<string | null>(null);
  const query = useData<SupplierFinancial>(
    'supplier-financial',
    '/suppliers/' + id + '/financial?page=' + paymentPage,
  );
  const receipts = useData<Page<PurchaseReceipt>>(
    'supplier-receipts',
    '/inventory/receipts?supplierId=' + id + '&page=' + page,
  );
  const data = query.data;
  return (
    <>
      <Dialog
        title={data ? data.supplier.name + ' — purchases and payments' : 'Supplier overview'}
        onClose={onClose}
        variant="drawer"
      >
        <Feedback query={query} />
        {data && (
          <>
            <p>
              {[
                data.supplier.contactPerson,
                data.supplier.phone,
                data.supplier.email,
                data.supplier.address,
              ]
                .filter(Boolean)
                .join(' · ') || 'No contact details recorded'}
            </p>
            {data.supplier.notes && <p>{data.supplier.notes}</p>}
            <div className="stats-grid">
              {[
                ['Recorded purchases', data.purchaseCount, 'All receipt history'],
                ['Purchase value', formatMoney(data.totalPurchaseMinor), 'All recorded receipts'],
                [
                  'Recorded payments',
                  formatMoney(data.totalSupplierPaidMinor),
                  'Manually confirmed, less reversals',
                ],
                [
                  'Outstanding balance',
                  formatMoney(data.outstandingSupplierMinor),
                  'Current verified debt',
                ],
                [
                  'Unreconciled purchases',
                  data.unreconciledPurchases,
                  formatMoney(data.unreconciledPurchaseMinor) +
                    ' purchase value; payment history unknown',
                ],
              ].map(([label, value, note]) => (
                <SummaryCard key={label} label={label} value={value} note={note}>
                  <span>D</span>
                </SummaryCard>
              ))}
            </div>
            <Notice>
              Open a purchase to view its items, record a payment, or check its balance.
              Unreconciled history is excluded from verified debt.
            </Notice>
            <h3>Purchase history</h3>
            <Feedback query={receipts} />
            {receipts.data && (
              <>
                <PurchaseTable receipts={receipts.data.data} onOpen={setOpened} />
                <Pager page={page} total={receipts.data.total} onChange={setPage} />
              </>
            )}
            <h3>Payment history</h3>
            <DataTable
              columns={['Date', 'Purchase', 'Method', 'Amount', 'Reference / notes']}
              rows={data.payments.data.map((p) => [
                dateLabel(p.date),
                p.receipt?.reference,
                p.method.replaceAll('_', ' '),
                (p.reversalOfId ? 'Reversal ' : '') + formatMoney(p.amountMinor),
                [p.reference, p.notes].filter(Boolean).join(' · '),
              ])}
            />
            <Pager page={paymentPage} total={data.payments.total} onChange={setPaymentPage} />
          </>
        )}
      </Dialog>
      {opened && <ReceiptDetail id={opened} onClose={() => setOpened(null)} />}
    </>
  );
}
