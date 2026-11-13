import { useRef, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney, parseMoneyInput } from '@stockflow/shared';
import { request } from '../api';
import { Dialog, Notice } from '../components/ui';
import { type ProductList } from './catalogue';
import { PurchaseForm, PurchaseTable, ReceiptDetail, type PurchaseReceipt } from './purchasing';
import {
  DataTable,
  ErrorMessage,
  Feedback,
  Field,
  Pager,
  useData,
  useDebounced,
  type Page,
} from './workflows';
type Stock = {
  id: string;
  name: string;
  sku: string;
  quantity: string;
  lowStockThreshold: string;
  purchaseCostMinor: string;
};
type Movement = {
  id: string;
  product: { name: string };
  quantityDelta: string;
  quantityAfter: string;
  movementType: string;
  reason: string;
  actorId: string;
  createdAt: string;
};
function StockForm({ receiving, onClose }: { receiving: boolean; onClose: () => void }) {
  const client = useQueryClient(),
    key = useRef(crypto.randomUUID());
  const [search, setSearch] = useState(''),
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
    mutationFn: (data: Record<string, unknown>) =>
      request('/inventory/' + (receiving ? 'receipts' : 'adjustments'), {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    onSuccess: async () => {
      await client.invalidateQueries();
      onClose();
    },
  });
  return (
    <Dialog title={receiving ? 'Receive stock' : 'Adjust stock'} onClose={onClose}>
      <form
        className="settings-form"
        onSubmit={(e) => {
          e.preventDefault();
          setError('');
          try {
            const data = new FormData(e.currentTarget),
              body: Record<string, unknown> = {
                productId: data.get('productId'),
                quantity: data.get('quantity'),
                idempotencyKey: key.current,
              };
            if (receiving) {
              body.unitCostMinor = parseMoneyInput(String(data.get('cost')));
              body.reference = data.get('reference');
              if (data.get('supplierId')) body.supplierId = data.get('supplierId');
            } else {
              body.direction = data.get('direction');
              body.type = data.get('type');
              body.reason = data.get('reason');
            }
            mutation.mutate(body);
          } catch (err) {
            setError(err instanceof Error ? err.message : 'Check your values');
          }
        }}
      >
        <Field label="Find product" value={search} onChange={setSearch} required={false} />
        <Feedback query={products} />
        <Field label="Product">
          <select name="productId" required>
            <option value="">Select product</option>
            {products.data?.data.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} · {p.sku}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Quantity" name="quantity" type="number" />
        {receiving ? (
          <>
            <Field label="Purchase cost per unit (GMD)" name="cost" />
            <Field label="Reference number" name="reference" />
            <Field label="Supplier (optional)">
              <select name="supplierId">
                <option value="">No supplier</option>
                {suppliers.data
                  ?.filter((s) => s.isActive)
                  .map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
              </select>
            </Field>
          </>
        ) : (
          <>
            <Field label="Operation">
              <select name="type">
                <option value="OPENING">Opening stock (first movement only)</option>
                <option value="ADJUSTMENT">Stock correction</option>
                <option value="DAMAGE">Damaged stock</option>
              </select>
            </Field>
            <Field label="Direction">
              <select name="direction">
                <option value="ADD">Add stock</option>
                <option value="REMOVE">Remove stock</option>
              </select>
            </Field>
            <Field label="Reason" name="reason" />
          </>
        )}
        {error && (
          <p className="form-alert" role="alert">
            {error}
          </p>
        )}
        <ErrorMessage error={mutation.error} />
        <button className="button primary" disabled={mutation.isPending}>
          {mutation.isPending ? 'Saving…' : 'Confirm stock operation'}
        </button>
      </form>
    </Dialog>
  );
}
export default function Inventory() {
  const location = useLocation(),
    receipts = location.pathname.endsWith('/receipts'),
    movements = location.pathname.endsWith('/counts');
  const [search, setSearch] = useState(''),
    [low, setLow] = useState(false),
    [page, setPage] = useState(1),
    [form, setForm] = useState<'receive' | 'adjust' | null>(null);
  const [openedReceipt, setOpenedReceipt] = useState<string | null>(null);
  const [from, setFrom] = useState(''),
    [to, setTo] = useState('');
  const searchValue = useDebounced(search);
  const stock = useData<Page<Stock>>(
    'inventory',
    `/inventory?search=${encodeURIComponent(searchValue)}&page=${page}${low ? '&low=true' : ''}`,
    !receipts && !movements,
  );
  const history = useData<Page<Movement>>(
    'movements',
    '/inventory/movements?page=' +
      page +
      '&search=' +
      encodeURIComponent(searchValue) +
      (new URLSearchParams(location.search).get('productId')
        ? '&productId=' + encodeURIComponent(new URLSearchParams(location.search).get('productId')!)
        : ''),
    movements,
  );
  const supplierId = new URLSearchParams(location.search).get('supplierId');
  const received = useData<Page<PurchaseReceipt>>(
    'receipts',
    `/inventory/receipts?search=${encodeURIComponent(searchValue)}&page=${page}${supplierId ? '&supplierId=' + encodeURIComponent(supplierId) : ''}${from ? '&from=' + from : ''}${to ? '&to=' + to : ''}`,
    receipts,
  );
  const query = receipts ? received : movements ? history : stock;
  return (
    <>
      <div className="catalogue-toolbar">
        <nav className="workflow-links">
          <Link to="/inventory">Stock levels</Link>
          <Link to="/inventory/receipts">Stock receipts</Link>
          <Link to="/inventory/counts">Movement history</Link>
        </nav>
        <div className="workflow-links">
          <button className="button secondary" onClick={() => setForm('adjust')}>
            Opening stock / adjustment
          </button>
          <button className="button primary" onClick={() => setForm('receive')}>
            Receive stock
          </button>
        </div>
      </div>
      <div className="catalogue-toolbar">
        <Field
          label="Search inventory"
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          required={false}
        />
        {!receipts && !movements && (
          <label className="check-field">
            <input
              type="checkbox"
              checked={low}
              onChange={(e) => {
                setLow(e.target.checked);
                setPage(1);
              }}
            />
            Low stock only
          </label>
        )}
        {receipts && (
          <>
            <Field
              label="Received from"
              type="date"
              value={from}
              required={false}
              onChange={(v) => {
                setFrom(v);
                setPage(1);
              }}
            />
            <Field
              label="Received to"
              type="date"
              value={to}
              required={false}
              onChange={(v) => {
                setTo(v);
                setPage(1);
              }}
            />
          </>
        )}
      </div>
      <Feedback query={query} />
      {movements && (
        <Notice>
          Stock movements are append-only. Corrections require a new movement and a reason.
        </Notice>
      )}
      {!query.error &&
        !query.isPending &&
        (receipts ? (
          <PurchaseTable receipts={received.data?.data ?? []} onOpen={setOpenedReceipt} />
        ) : movements ? (
          <DataTable
            columns={[
              'Product',
              'Movement',
              'Change',
              'Resulting stock',
              'Reason',
              'Responsible user',
              'Date',
            ]}
            rows={(history.data?.data ?? []).map((m) => [
              m.product.name,
              m.movementType,
              m.quantityDelta,
              m.quantityAfter,
              m.reason,
              m.actorId ?? 'Legacy record',
              new Date(m.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Banjul' }),
            ])}
          />
        ) : (
          <DataTable
            columns={['Product', 'SKU', 'Stock', 'Minimum', 'Status', 'Unit cost']}
            rows={(stock.data?.data ?? []).map((p) => [
              p.name,
              p.sku,
              p.quantity,
              p.lowStockThreshold,
              Number(p.quantity) <= Number(p.lowStockThreshold) ? 'Low stock' : 'In stock',
              formatMoney(p.purchaseCostMinor),
            ])}
            empty="No products yet. Add your first product."
          />
        ))}
      {query.data && <Pager page={page} total={query.data.total} onChange={setPage} />}{' '}
      {form === 'receive' && (
        <PurchaseForm
          onClose={() => setForm(null)}
          onSaved={(receipt) => setOpenedReceipt(receipt.id)}
        />
      )}
      {form === 'adjust' && <StockForm receiving={false} onClose={() => setForm(null)} />}
      {openedReceipt && <ReceiptDetail id={openedReceipt} onClose={() => setOpenedReceipt(null)} />}
    </>
  );
}
