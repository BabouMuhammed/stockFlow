import { useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney } from '@stockflow/shared';
import { request } from '../api';
import { Dialog, Notice } from '../components/ui';
import { useSession } from './session';
import Receipt, { type SaleRecord } from './receipts';
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
function ReturnForm({ sale, onClose }: { sale: SaleRecord; onClose: () => void }) {
  const key = useRef(crypto.randomUUID()),
    client = useQueryClient();
  const mutation = useMutation({
    mutationFn: (body: unknown) =>
      request('/sales/' + sale.id + '/returns', { method: 'POST', body: JSON.stringify(body) }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog title="Return purchased items" onClose={onClose}>
      <Notice>
        Record a refund only after arranging it separately. This action does not transfer money.
      </Notice>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          const data = new FormData(e.currentTarget);
          mutation.mutate({
            idempotencyKey: key.current,
            reason: data.get('reason'),
            refundMethod: data.get('refundMethod'),
            manualConfirmation: true,
            items: [
              {
                saleItemId: data.get('saleItemId'),
                quantity: data.get('quantity'),
                restock: data.get('restock') === 'on',
              },
            ],
          });
        }}
      >
        <Field label="Purchased item">
          <select name="saleItemId">
            {sale.items.map((i) => (
              <option value={i.id} key={i.id}>
                {i.productName} · sold {i.quantity}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Return quantity" name="quantity" type="number" />
        <Field label="Return reason" name="reason" />
        <Field label="Refund method">
          <select name="refundMethod">{paymentOptions}</select>
        </Field>
        <label className="check-field">
          <input type="checkbox" name="restock" />
          Return to sellable stock
        </label>
        <label className="check-field">
          <input type="checkbox" required />I have arranged and confirmed this refund
        </label>
        <ErrorMessage error={mutation.error} />
        <button className="button primary" disabled={mutation.isPending}>
          Record return and refund
        </button>
      </form>
    </Dialog>
  );
}
export default function Sales() {
  const { session } = useSession();
  const [search, setSearch] = useState(''),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [payment, setPayment] = useState(''),
    [cashier, setCashier] = useState(''),
    [page, setPage] = useState(1);
  const [receipt, setReceipt] = useState<SaleRecord | null>(null),
    [returning, setReturning] = useState<SaleRecord | null>(null);
  const params = new URLSearchParams({ search: useDebounced(search), page: String(page) });
  if (from) params.set('from', from);
  if (to) params.set('to', to);
  if (payment) params.set('paymentMethod', payment);
  if (cashier) params.set('cashierId', cashier);
  const query = useData<Page<SaleRecord>>('sales', '/sales?' + params),
    staff = useData<{ id: string; name: string }[]>(
      'staff',
      '/staff',
      session?.user.role === 'OWNER',
    );
  return (
    <>
      <div className="report-filters">
        <Field
          label="Find receipt"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          required={false}
        />
        <Field
          label="From"
          type="date"
          value={from}
          onChange={(v) => {
            setFrom(v);
            setPage(1);
          }}
          required={false}
        />
        <Field
          label="To"
          type="date"
          value={to}
          onChange={(v) => {
            setTo(v);
            setPage(1);
          }}
          required={false}
        />
        <Field label="Payment filter">
          <select
            value={payment}
            onChange={(e) => {
              setPayment(e.target.value);
              setPage(1);
            }}
          >
            <option value="">All payments</option>
            {paymentOptions}
          </select>
        </Field>
        {staff.data && (
          <Field label="Cashier filter">
            <select
              value={cashier}
              onChange={(e) => {
                setCashier(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All staff</option>
              {staff.data.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </Field>
        )}
      </div>
      <Feedback query={query} />
      {!query.error && !query.isPending && (
        <DataTable
          columns={['Receipt', 'Date', 'Cashier', 'Total', 'Payment', 'Refunded', 'Actions']}
          rows={(query.data?.data ?? []).map((s) => [
            s.receiptNumber,
            new Date(s.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Banjul' }),
            s.cashierName ?? 'Legacy record',
            formatMoney(s.totalMinor),
            s.paymentMethod.replaceAll('_', ' '),
            formatMoney(s.returns.reduce((v, r) => v + BigInt(r.refundMinor), 0n)),
            <div className="workflow-links">
              <button className="quiet-action" onClick={() => setReceipt(s)}>
                View / print
              </button>
              {session?.user.role !== 'CASHIER' && (
                <button className="quiet-action" onClick={() => setReturning(s)}>
                  Return
                </button>
              )}
            </div>,
          ])}
          empty="No sales yet"
        />
      )}
      {query.data && <Pager page={page} total={query.data.total} onChange={setPage} />}{' '}
      {receipt && <Receipt sale={receipt} onClose={() => setReceipt(null)} />}{' '}
      {returning && <ReturnForm sale={returning} onClose={() => setReturning(null)} />}
    </>
  );
}
