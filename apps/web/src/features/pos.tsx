import { useEffect, useRef, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import {
  formatMoney,
  parseMoneyInput,
  parseQuantityInput,
  quantityInputValue,
} from '@stockflow/shared';
import { ApiError, request } from '../api';
import { EmptyState, Notice } from '../components/ui';
import { type Product, type ProductList, type Category, productImageUrl } from './catalogue';
import { useSession } from './session';
import { CartItem, CategoryTabs, ProductCard } from '../components/retail';
import {
  ErrorMessage,
  Feedback,
  Field,
  MinorEstimate,
  paymentOptions,
  useData,
  useDebounced,
  type Page,
} from './workflows';
import Receipt, { type SaleRecord } from './receipts';

type Checkout = {
  idempotencyKey: string;
  items: { productId: string; quantity: string }[];
  paymentMethod: string;
  amountReceived?: string;
  exactPayment?: true;
  manualConfirmation: boolean;
  paymentReference?: string;
  customerId?: string;
  discount?: { type: 'FIXED'; amountMinor: string } | { type: 'PERCENT'; basisPoints: number };
};
function QuantityInput({
  quantity,
  max,
  onChange,
}: {
  quantity: string;
  max: string;
  onChange: (quantity: string) => void;
}) {
  const [draft, setDraft] = useState(String(quantity));
  useEffect(() => setDraft(String(quantity)), [quantity]);
  return (
    <input
      inputMode="decimal"
      value={draft}
      onChange={(e) => {
        const value = e.target.value;
        setDraft(value);
        try {
          const parsed = parseQuantityInput(value);
          if (parsed > 0n && parsed <= parseQuantityInput(max)) onChange(value);
        } catch {
          /* Keep incomplete quantity input editable. */
        }
      }}
      onBlur={() => setDraft(String(quantity))}
    />
  );
}
export default function Pos() {
  const { session } = useSession(),
    client = useQueryClient();
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [cart, setCart] = useState<{ product: Product; quantity: string }[]>([]);
  const [payment, setPayment] = useState('CASH'),
    [received, setReceived] = useState(''),
    [confirmed, setConfirmed] = useState(false),
    [reference, setReference] = useState('');
  const [discountType, setDiscountType] = useState('FIXED'),
    [discount, setDiscount] = useState(''),
    [customerId, setCustomerId] = useState(''),
    [customerSearch, setCustomerSearch] = useState('');
  const [receipt, setReceipt] = useState<SaleRecord | null>(null),
    [localError, setLocalError] = useState(''),
    [locked, setLocked] = useState(false);
  const submission = useRef<Checkout | null>(null);
  const inFlight = useRef(false);
  const categories = useData<Category[]>('categories', '/categories');
  const params = new URLSearchParams({
    search: useDebounced(search),
    active: 'true',
    limit: '100',
  });
  const categoryId = categories.data?.find((c) => c.name === category)?.id;
  if (categoryId) params.set('categoryId', categoryId);
  const products = useData<ProductList>('pos-products', '/products?' + params);
  const customers = useData<Page<{ id: string; name: string }>>(
    'pos-customers',
    '/customers?limit=25&search=' + encodeURIComponent(useDebounced(customerSearch)),
  );
  const total = cart.reduce(
    (s, l) => s + MinorEstimate(l.product.sellingPriceMinor, String(l.quantity)),
    0n,
  );
  let discountMinor = 0n;
  try {
    discountMinor = discount
      ? discountType === 'FIXED'
        ? BigInt(parseMoneyInput(discount))
        : (total * BigInt(parseMoneyInput(discount)) + 5000n) / 10000n
      : 0n;
  } catch {
    /* Form validation runs before submission. */
  }
  const net = total - discountMinor;
  const exactCash = payment === 'CASH' && received.trim() === '';
  let change: bigint | null = null;
  let receivedMinor: bigint | null = null;
  try {
    receivedMinor = exactCash ? net : BigInt(parseMoneyInput(received));
    change = receivedMinor - net;
  } catch {
    /* Incomplete input. */
  }
  const add = (product: Product) => {
    if (locked) return;
    const available = parseQuantityInput(product.quantity ?? '0');
    const currentLine = cart.find((l) => l.product.id === product.id);
    const scaled =
      parseQuantityInput(currentLine?.quantity ?? '0') +
      (!currentLine && available < 1000n ? available : 1000n);
    const quantity = quantityInputValue(scaled);
    if (scaled === 0n || scaled > available) {
      setLocalError('Available stock is too low for ' + product.name);
      return;
    }
    setLocalError('');
    setCart((current) =>
      current.some((l) => l.product.id === product.id)
        ? current.map((l) => (l.product.id === product.id ? { ...l, quantity } : l))
        : [...current, { product, quantity }],
    );
  };
  const checkout = useMutation({
    mutationFn: (input: Checkout) =>
      request<SaleRecord>('/sales', { method: 'POST', body: JSON.stringify(input) }),
    onSuccess: async (sale) => {
      setReceipt(sale);
      setCart([]);
      setReceived('');
      setDiscount('');
      setConfirmed(false);
      setReference('');
      submission.current = null;
      setLocked(false);
      await client.invalidateQueries();
    },
    onError: (error) => {
      if (
        error instanceof ApiError &&
        error.status >= 400 &&
        error.status < 500 &&
        error.status !== 429
      ) {
        submission.current = null;
        setLocked(false);
      }
    },
    onSettled: () => {
      inFlight.current = false;
    },
  });
  const submit = () => {
    if (inFlight.current) return;
    setLocalError('');
    if (submission.current) {
      inFlight.current = true;
      checkout.mutate(submission.current);
      return;
    }
    try {
      if (!cart.length) throw new Error('Add a product first');
      if (net < 0n) throw new Error('Discount cannot exceed the subtotal');
      if (!exactCash && BigInt(parseMoneyInput(received)) < net)
        throw new Error('Amount received is below the total');
      if (discountType === 'PERCENT' && discount && BigInt(parseMoneyInput(discount)) > 10000n)
        throw new Error('Percentage cannot exceed 100');
      const input: Checkout = {
        idempotencyKey: crypto.randomUUID(),
        items: cart.map((l) => ({ productId: l.product.id, quantity: String(l.quantity) })),
        paymentMethod: payment,
        ...(exactCash ? { exactPayment: true as const } : { amountReceived: received.trim() }),
        manualConfirmation: confirmed,
        paymentReference: reference || undefined,
        customerId: customerId || undefined,
        ...(discount
          ? {
              discount:
                discountType === 'FIXED'
                  ? { type: 'FIXED' as const, amountMinor: parseMoneyInput(discount) }
                  : { type: 'PERCENT' as const, basisPoints: Number(parseMoneyInput(discount)) },
            }
          : {}),
      };
      submission.current = input;
      inFlight.current = true;
      setLocked(true);
      checkout.mutate(input);
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'Check the order');
    }
  };
  return (
    <>
      <a className="mobile-cart-link" href="#cart-summary">
        View cart · {formatMoney(net)}
      </a>
      <div className="pos-layout live-pos-layout">
        <section className="pos-products" id="pos-products">
          <div className="pos-section-heading">
            <div>
              <h2>Find your products</h2>
              <p>Search name, SKU or scan a barcode.</p>
            </div>
            <Field
              label="Search POS products"
              value={search}
              onChange={setSearch}
              required={false}
            />
          </div>
          <CategoryTabs
            categories={(categories.data ?? [])
              .filter((c) => c.isActive !== false)
              .map((c) => c.name)}
            value={category}
            onChange={setCategory}
          />
          <Feedback query={products} />
          <Feedback query={categories} />
          <div className="pos-product-grid">
            {products.data?.data.map((p) => (
              <ProductCard
                key={p.id}
                name={p.name}
                imageSource={productImageUrl(p)}
                sku={p.sku}
                category={p.category?.name ?? 'Uncategorised'}
                price={formatMoney(p.sellingPriceMinor)}
                availability={(p.quantity ?? '0') + ' in stock'}
                selected={cart.find((l) => l.product.id === p.id)?.quantity}
                onSelect={() => add(p)}
                pos
              />
            ))}
          </div>
          {products.data && !products.data.data.length && (
            <EmptyState
              title="No matching products"
              detail="Add products and receive stock to begin selling."
            />
          )}
          {products.data && products.data.total > 100 && (
            <p>Showing the first 100 matches. Refine your search.</p>
          )}
        </section>
        <aside className="cart-panel live-cart" id="cart-summary" aria-label="Order summary">
          <div className="cart-heading">
            <h2>Current order</h2>
            <button
              className="quiet-action"
              disabled={locked || !cart.length}
              onClick={() => {
                if (window.confirm('Clear this order?')) setCart([]);
              }}
            >
              Clear cart
            </button>
          </div>
          <fieldset disabled={locked} className="live-cart-fieldset">
            <div className="cart-lines">
              {!cart.length ? (
                <EmptyState
                  title="Start with a product"
                  detail="Select an available product to add it to the order."
                />
              ) : (
                cart.map((l) => (
                  <div key={l.product.id}>
                    <CartItem
                      name={l.product.name}
                      price={formatMoney(l.product.sellingPriceMinor)}
                      quantity={l.quantity}
                      total={formatMoney(
                        MinorEstimate(l.product.sellingPriceMinor, String(l.quantity)),
                      )}
                      onIncrease={() => add(l.product)}
                      onDecrease={() =>
                        setCart((c) =>
                          c.flatMap((x) =>
                            x.product.id !== l.product.id
                              ? [x]
                              : parseQuantityInput(x.quantity) > 1000n
                                ? [
                                    {
                                      ...x,
                                      quantity: quantityInputValue(
                                        parseQuantityInput(x.quantity) - 1000n,
                                      ),
                                    },
                                  ]
                                : [],
                          ),
                        )
                      }
                      onRemove={() =>
                        setCart((c) => c.filter((x) => x.product.id !== l.product.id))
                      }
                    />
                    <label className="field">
                      Quantity for {l.product.name}
                      <QuantityInput
                        quantity={l.quantity}
                        max={l.product.quantity ?? '0'}
                        onChange={(quantity) =>
                          setCart((c) =>
                            c.map((x) => (x.product.id === l.product.id ? { ...x, quantity } : x)),
                          )
                        }
                      />
                    </label>
                  </div>
                ))
              )}
            </div>
            <div className="cart-checkout">
              <div className="subtotal-row">
                <span>Subtotal</span>
                <strong>{formatMoney(total)}</strong>
              </div>
              {session?.user.role !== 'CASHIER' && (
                <div className="form-grid">
                  <Field label="Discount type">
                    <select value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                      <option value="FIXED">Fixed GMD</option>
                      <option value="PERCENT">Percentage</option>
                    </select>
                  </Field>
                  <Field
                    label="Discount"
                    value={discount}
                    onChange={setDiscount}
                    required={false}
                  />
                </div>
              )}
              <div className="total-row">
                <span>Total GMD</span>
                <strong>{formatMoney(net)}</strong>
              </div>
              <Field label="Payment method">
                <select
                  value={payment}
                  onChange={(e) => {
                    setPayment(e.target.value);
                    setConfirmed(false);
                  }}
                >
                  {paymentOptions}
                </select>
              </Field>
              <label className="field">
                Amount received (GMD)
                <input
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  placeholder={payment === 'CASH' ? 'Optional — exact cash payment' : undefined}
                  value={received}
                  aria-describedby="payment-amount-help"
                  onChange={(e) => {
                    setReceived(e.target.value);
                    setLocalError('');
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                      e.preventDefault();
                      if (!checkout.isPending) submit();
                    }
                  }}
                />
              </label>
              <small id="payment-amount-help">
                {payment === 'CASH'
                  ? 'Optional for cash. Confirm checkout only after receiving the full payment. Enter an amount if change is needed.'
                  : 'Enter the verified amount, such as 390, 390.5 or 390.50. Up to two decimal places.'}
              </small>
              {exactCash && <p aria-live="polite">Exact payment — {formatMoney(net)}</p>}
              {!exactCash && receivedMinor !== null && (
                <p aria-live="polite">Received: {formatMoney(receivedMinor)}</p>
              )}
              {payment === 'CASH' && (
                <p aria-live="polite">
                  Change: {change !== null && change >= 0n ? formatMoney(change) : '—'}
                </p>
              )}
              {payment !== 'CASH' && (
                <>
                  <Notice>
                    This records a payment you received separately. StockFlow does not transfer or
                    verify money.
                  </Notice>
                  <Field label="Payment reference" value={reference} onChange={setReference} />
                  <label className="check-field">
                    <input
                      type="checkbox"
                      checked={confirmed}
                      onChange={(e) => setConfirmed(e.target.checked)}
                    />
                    I confirmed the payment was received
                  </label>
                </>
              )}
              <Field
                label="Find customer (optional)"
                value={customerSearch}
                onChange={setCustomerSearch}
                required={false}
              />
              <Field label="Customer">
                <select value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
                  <option value="">Walk-in customer</option>
                  {customers.data?.data.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          </fieldset>
          <div className="cart-checkout">
            <ErrorMessage error={checkout.error} />
            {localError && (
              <p role="alert" className="form-alert">
                {localError}
              </p>
            )}
            {locked && !checkout.isPending && (
              <Notice>
                The result is uncertain. Retry this same order to check its status safely.
              </Notice>
            )}
            <button
              className="button primary full-button"
              disabled={!cart.length || checkout.isPending}
              onClick={submit}
            >
              {checkout.isPending
                ? 'Recording sale…'
                : locked
                  ? 'Retry this checkout'
                  : 'Confirm checkout'}
            </button>
          </div>
        </aside>
      </div>
      {receipt && (
        <>
          <p role="status">Sale completed successfully. Your receipt is ready.</p>
          <Receipt sale={receipt} onClose={() => setReceipt(null)} />
        </>
      )}
    </>
  );
}
