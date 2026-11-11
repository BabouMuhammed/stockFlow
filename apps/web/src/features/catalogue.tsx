import ProductImage, { ProductPhotoCredits } from '../components/ProductImage';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Search, Plus, SlidersHorizontal, List, Grid2X2 } from '../components/icons';
import { formatMoney, moneyInputValue, parseMoneyInput } from '@stockflow/shared';
import { API_BASE_URL, ApiError, request } from '../api';
import { Dialog, EmptyState, Notice } from '../components/ui';
import { useSession } from './session';
import { ProductCard, ProductDrawer, StatusBadge } from '../components/retail';
import { useDebounced } from './workflows';

export type Category = { id: string; name: string; isActive?: boolean };
export type Product = {
  id: string;
  name: string;
  sku: string;
  barcode: string | null;
  categoryId: string | null;
  category: Category | null;
  unit: string;
  lowStockThreshold: string;
  sellingPriceMinor: string;
  purchaseCostMinor?: string;
  isActive: boolean;
  quantity?: string;
  description?: string;
  imageKey?: string | null;
  supplierId?: string | null;
};
export type ProductList = { data: Product[]; page: number; limit: number; total: number };
export const productImageUrl = (p: Product) =>
  p.imageKey ? `${API_BASE_URL}/products/${p.id}/image?v=${p.imageKey}` : undefined;
export function QueryFeedback({
  pending,
  error,
  retry,
}: {
  pending: boolean;
  error: Error | null;
  retry: () => void;
}) {
  if (pending)
    return (
      <div className="state-panel" role="status">
        Loading your workspace...
      </div>
    );
  if (error)
    return (
      <div className="form-alert" role="alert">
        <p>{error.message}</p>
        <button className="button secondary" onClick={retry}>
          Try again
        </button>
      </div>
    );
  return null;
}
function validMoney(value: string, positive = false) {
  try {
    return !positive || BigInt(parseMoneyInput(value)) > 0n;
  } catch {
    return false;
  }
}
const schema = z.object({
  name: z.string().trim().min(1, 'Enter a product name').max(120),
  sku: z.string().trim().max(60),
  barcode: z.string().trim().max(80),
  categoryId: z.string(),
  unit: z.string().trim().min(1, 'Enter a unit').max(30),
  purchaseCost: z.string().refine((v) => {
    try {
      parseMoneyInput(v);
      return true;
    } catch {
      return false;
    }
  }, 'Enter a valid purchase cost (up to 2 decimal places)'),
  sellingPrice: z
    .string()
    .refine((v) => validMoney(v, true), 'Enter a positive selling price (up to 2 decimal places)'),
  lowStockThreshold: z
    .string()
    .regex(
      /^(0|[1-9][0-9]{0,14})(\.[0-9]{1,3})?$/,
      'Use a nonnegative quantity with up to 3 decimals',
    ),
  isActive: z.boolean(),
});
type Values = z.infer<typeof schema>;
function ProductForm({
  product,
  categories,
  onSaved,
  onClose,
}: {
  product?: Product;
  categories: Category[];
  onSaved: () => void;
  onClose: () => void;
}) {
  const [opening, setOpening] = useState('0'),
    [description, setDescription] = useState(product?.description ?? ''),
    [supplierId, setSupplierId] = useState(product?.supplierId ?? '');
  const { session } = useSession();
  const suppliers = useQuery({
    queryKey: ['suppliers', session?.business.id],
    queryFn: () => request<{ id: string; name: string; isActive: boolean }[]>('/suppliers'),
  });
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: product?.name ?? '',
      sku: product?.sku ?? '',
      barcode: product?.barcode ?? '',
      categoryId: product?.categoryId ?? '',
      unit: product?.unit ?? 'unit',
      purchaseCost: moneyInputValue(product?.purchaseCostMinor ?? '0'),
      sellingPrice: moneyInputValue(product?.sellingPriceMinor ?? '0'),
      lowStockThreshold:
        product?.lowStockThreshold ?? session?.business.defaultLowStockThreshold ?? '5.000',
      isActive: product?.isActive ?? true,
    },
  });
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      request<Product>(product ? '/products/' + product.id : '/products', {
        method: product ? 'PATCH' : 'POST',
        body: JSON.stringify({
          name: values.name,
          ...(values.sku ? { sku: values.sku } : {}),
          barcode: values.barcode || null,
          categoryId: values.categoryId || null,
          unit: values.unit,
          purchaseCostMinor: parseMoneyInput(values.purchaseCost),
          sellingPriceMinor: parseMoneyInput(values.sellingPrice),
          lowStockThreshold: values.lowStockThreshold,
          isActive: values.isActive,
          description,
          supplierId: supplierId || null,
          ...(!product ? { openingStock: opening } : {}),
        }),
      }),
    onSuccess: onSaved,
    onError: (error) => {
      if (error instanceof ApiError)
        for (const issue of error.issues) {
          const path =
            (
              { purchaseCostMinor: 'purchaseCost', sellingPriceMinor: 'sellingPrice' } as Record<
                string,
                string
              >
            )[issue.path] ?? issue.path;
          if (path in form.getValues())
            form.setError(path as keyof Values, { message: issue.message });
        }
    },
  });
  const field = (name: keyof Values, label: string, inputMode?: 'decimal') => (
    <label className="field">
      {label}
      <input
        {...form.register(name)}
        inputMode={inputMode}
        aria-invalid={!!form.formState.errors[name]}
      />
      {form.formState.errors[name] && (
        <small className="field-error" role="alert">
          {form.formState.errors[name]?.message}
        </small>
      )}
    </label>
  );
  return (
    <Dialog title={product ? 'Edit product' : 'Add product'} onClose={onClose}>
      <form
        noValidate
        className="form-grid"
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        {field('name', 'Product name')}
        {product ? (
          field('sku', 'SKU')
        ) : (
          <label className="field">
            Custom SKU (optional)
            <input {...form.register('sku')} placeholder="Automatically generated" maxLength={60} />
            <small>Automatically generated unless you enter your own code.</small>
          </label>
        )}
        {field('barcode', 'Barcode')}
        <label className="field">
          Category
          <select {...form.register('categoryId')}>
            <option value="">Uncategorised</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        {field('unit', 'Unit')}
        <label className="field">
          Supplier
          <select value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
            <option value="">No supplier</option>
            {suppliers.data
              ?.filter((s) => s.isActive)
              .map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
          </select>
        </label>
        <label className="field full-field">
          Description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={2000}
          />
        </label>
        {!product && (
          <label className="field">
            Opening stock
            <input
              value={opening}
              onChange={(e) => setOpening(e.target.value)}
              inputMode="decimal"
            />
          </label>
        )}
        {field('lowStockThreshold', 'Low-stock threshold', 'decimal')}
        {field('purchaseCost', 'Purchase cost (GMD)', 'decimal')}
        {field('sellingPrice', 'Selling price (GMD)', 'decimal')}
        <label className="check-field full-field">
          <input type="checkbox" {...form.register('isActive')} />
          Active product
        </label>
        <div className="full-field">
          <Notice>
            {product
              ? 'Use Inventory to receive or adjust stock.'
              : 'Opening stock creates an audited inventory movement.'}{' '}
            Units include piece, pack, carton, bottle, kilogram, gram, liter and bag.
          </Notice>
        </div>
        {mutation.error && (
          <p role="alert" className="form-alert full-field">
            {mutation.error.message}
          </p>
        )}
        <div className="modal-actions full-field">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save product'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export default function Catalogue() {
  const { session } = useSession();
  const client = useQueryClient();
  const editable = session?.user.role !== 'CASHIER';
  const [search, setSearch] = useState(''),
    [category, setCategory] = useState(''),
    [active, setActive] = useState(''),
    [page, setPage] = useState(1),
    [view, setView] = useState<'grid' | 'table'>('table');
  const [selected, setSelected] = useState<Product | null>(null),
    [editing, setEditing] = useState<Product | null | undefined>(undefined),
    [saved, setSaved] = useState('');
  const [sort, setSort] = useState('name');
  const params = new URLSearchParams({ search, page: String(page), limit: '24' });
  const debouncedSearch = useDebounced(search);
  params.set('search', debouncedSearch);
  params.set('sort', sort);
  if (category) params.set('categoryId', category);
  if (active) params.set('active', active);
  const query = useQuery({
    queryKey: [
      'products',
      session?.business.id,
      session?.user.role,
      debouncedSearch,
      category,
      active,
      page,
      sort,
    ],
    queryFn: ({ signal }) => request<ProductList>('/products?' + params, { signal }),
  });
  const categories = useQuery({
    queryKey: ['categories', session?.business.id, session?.user.role],
    queryFn: () => request<Category[]>('/categories'),
  });
  const toggle = useMutation({
    mutationFn: (product: Product) =>
      request<Product>('/products/' + product.id, {
        method: 'PATCH',
        body: JSON.stringify({ isActive: !product.isActive }),
      }),
    onSuccess: async () => {
      setSaved('Product status saved.');
      await client.invalidateQueries({ queryKey: ['products'] });
    },
  });
  const rows = query.data?.data ?? [];
  return (
    <>
      <div className="catalogue-workspace">
        <aside className="catalogue-filters" aria-label="Catalogue filters">
          <h2>
            <SlidersHorizontal size={17} />
            Filters
          </h2>
          <label className="field" htmlFor="live-category">
            Category filter
            <select
              id="live-category"
              value={category}
              onChange={(e) => {
                setCategory(e.target.value);
                setPage(1);
              }}
            >
              <option value="">All categories</option>
              {categories.data?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          {editable && (
            <label className="field" htmlFor="active-filter">
              Product status
              <select
                id="active-filter"
                value={active}
                onChange={(e) => {
                  setActive(e.target.value);
                  setPage(1);
                }}
              >
                <option value="">All statuses</option>
                <option value="true">Active</option>
                <option value="false">Inactive</option>
              </select>
            </label>
          )}
          <div className="filter-info">
            <span>Stock availability</span>
            <StatusBadge>Main store</StatusBadge>
            <p>Available quantities come from recorded inventory movements.</p>
          </div>
          <label className="field">
            Sort products
            <select
              value={sort}
              onChange={(e) => {
                setSort(e.target.value);
                setPage(1);
              }}
            >
              <option value="name">Name</option>
              <option value="price">Selling price</option>
              <option value="newest">Newest first</option>
            </select>
          </label>
          <div className="filter-info">
            <span>Catalogue source</span>
            <p>Your business database. Prices are shown in Gambian dalasis.</p>
          </div>
          <button
            className="text-link reset-filters"
            onClick={() => {
              setSearch('');
              setCategory('');
              setActive('');
              setPage(1);
            }}
          >
            Reset filters
          </button>
        </aside>
        <section className="catalogue-main">
          <div className="catalogue-toolbar">
            <label className="filter-search">
              <Search size={18} />
              <input
                aria-label="Search products"
                placeholder="Search name, SKU or barcode"
                value={search}
                onChange={(e) => {
                  setSearch(e.target.value);
                  setPage(1);
                }}
              />
            </label>
            {editable && (
              <button className="button primary" onClick={() => setEditing(null)}>
                <Plus size={17} />
                Add product
              </button>
            )}
          </div>
          <div className="catalogue-heading">
            <div>
              <h2>Product catalogue</h2>
              <span>
                {query.data
                  ? query.data.total + ' products in your business'
                  : 'Your business catalogue'}
              </span>
            </div>
            <div className="segmented">
              <button
                aria-pressed={view === 'table'}
                className={view === 'table' ? 'selected' : ''}
                onClick={() => setView('table')}
              >
                <List size={16} />
                Table
              </button>
              <button
                aria-pressed={view === 'grid'}
                className={view === 'grid' ? 'selected' : ''}
                onClick={() => setView('grid')}
              >
                <Grid2X2 size={16} />
                Cards
              </button>
            </div>
          </div>
          {saved && <Notice>{saved}</Notice>}
          {toggle.error && (
            <div className="form-alert" role="alert">
              {toggle.error.message}
            </div>
          )}
          {categories.error && (
            <QueryFeedback
              pending={false}
              error={categories.error}
              retry={() => {
                void categories.refetch();
              }}
            />
          )}
          <QueryFeedback
            pending={query.isPending}
            error={query.error}
            retry={() => {
              void query.refetch();
            }}
          />
          {!query.isPending &&
            !query.error &&
            (!rows.length ? (
              <section className="panel">
                <EmptyState
                  title="No matching products"
                  detail="Try another search or add your first product."
                />
              </section>
            ) : view === 'grid' ? (
              <div className="catalogue-grid">
                {rows.map((p) => (
                  <ProductCard
                    key={p.id}
                    name={p.name}
                    imageSource={productImageUrl(p)}
                    sku={p.sku}
                    category={p.category?.name ?? 'Uncategorised'}
                    price={formatMoney(p.sellingPriceMinor)}
                    availability={p.isActive ? 'Active' : 'Inactive'}
                    onSelect={() => setSelected(p)}
                  />
                ))}
              </div>
            ) : (
              <section className="panel catalogue-table">
                <div
                  className="table-scroll"
                  role="region"
                  aria-label="Product catalogue table"
                  tabIndex={0}
                >
                  <table>
                    <caption className="sr-only">
                      Product catalogue from your business database
                    </caption>
                    <thead>
                      <tr>
                        <th>Product</th>
                        <th>SKU / barcode</th>
                        <th>Category</th>
                        {editable && <th>Purchase cost</th>}
                        <th>Selling price</th>
                        <th>Available stock</th>
                        <th>Status</th>
                        {editable && <th>Actions</th>}
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((p) => (
                        <tr key={p.id}>
                          <td>
                            <div className="product-table-name">
                              <span className="table-product-image">
                                <ProductImage
                                  name={p.name}
                                  source={
                                    p.imageKey
                                      ? `${API_BASE_URL}/products/${p.id}/image?v=${p.imageKey}`
                                      : undefined
                                  }
                                />
                              </span>
                              <div>
                                <h3>
                                  <button className="quiet-action" onClick={() => setSelected(p)}>
                                    {p.name}
                                  </button>
                                </h3>
                                <small className="cell-subtext">Per {p.unit}</small>
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className="sku-text">{p.sku}</span>
                            <small className="cell-subtext">{p.barcode ?? 'No barcode'}</small>
                          </td>
                          <td>{p.category?.name ?? 'Uncategorised'}</td>
                          {editable && (
                            <td>
                              {p.purchaseCostMinor !== undefined
                                ? formatMoney(p.purchaseCostMinor)
                                : 'Unavailable'}
                            </td>
                          )}
                          <td className="money-cell">{formatMoney(p.sellingPriceMinor)}</td>
                          <td>
                            <StatusBadge
                              tone={
                                Number(p.quantity ?? 0) <= Number(p.lowStockThreshold)
                                  ? 'warning'
                                  : 'success'
                              }
                            >
                              {p.quantity ?? '0'} in stock
                            </StatusBadge>
                            <small className="cell-subtext">Minimum {p.lowStockThreshold}</small>
                          </td>
                          <td>
                            <StatusBadge tone={p.isActive ? 'success' : 'neutral'}>
                              {p.isActive ? 'Active' : 'Inactive'}
                            </StatusBadge>
                          </td>
                          {editable && (
                            <td>
                              <div className="table-actions">
                                <button className="quiet-action" onClick={() => setEditing(p)}>
                                  Edit {p.name}
                                </button>
                                <button
                                  className="quiet-action muted-action"
                                  disabled={toggle.isPending}
                                  onClick={() => {
                                    if (
                                      window.confirm(
                                        (p.isActive ? 'Archive ' : 'Restore ') + p.name + '?',
                                      )
                                    )
                                      toggle.mutate(p);
                                  }}
                                >
                                  {p.isActive ? 'Deactivate' : 'Activate'}
                                </button>
                              </div>
                            </td>
                          )}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ))}
          {rows.length > 0 && <ProductPhotoCredits />}
          {query.data && (
            <div className="catalogue-pagination">
              <span>{query.data.total} products</span>
              <button
                className="button secondary"
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
              >
                Previous
              </button>
              <span>Page {page}</span>
              <button
                className="button secondary"
                disabled={page * 24 >= query.data.total}
                onClick={() => setPage((p) => p + 1)}
              >
                Next
              </button>
            </div>
          )}
        </section>
      </div>
      {selected && (
        <ProductDrawer
          name={selected.name}
          imageSource={productImageUrl(selected)}
          onClose={() => setSelected(null)}
        >
          <dl className="product-detail">
            <dt>SKU</dt>
            <dd>{selected.sku}</dd>
            <dt>Barcode</dt>
            <dd>{selected.barcode ?? 'None'}</dd>
            <dt>Selling price</dt>
            <dd>{formatMoney(selected.sellingPriceMinor)}</dd>
            {selected.purchaseCostMinor !== undefined && (
              <>
                <dt>Purchase cost</dt>
                <dd>{formatMoney(selected.purchaseCostMinor)}</dd>
              </>
            )}
            <dt>Unit</dt>
            <dd>{selected.unit}</dd>
            <dt>Reorder threshold</dt>
            <dd>{selected.lowStockThreshold}</dd>
            <dt>Status</dt>
            <dd>
              <StatusBadge tone={selected.isActive ? 'success' : 'neutral'}>
                {selected.isActive ? 'Active' : 'Inactive'}
              </StatusBadge>
            </dd>
          </dl>
          <Notice>
            Available main-store stock: {selected.quantity ?? '0'}. {selected.description}
          </Notice>
          {editable && (
            <Link className="text-link" to={'/inventory/counts?productId=' + selected.id}>
              View stock history
            </Link>
          )}
          {editable && (
            <ImageUpload
              product={selected}
              onSaved={(key) => {
                setSelected({ ...selected, imageKey: key });
                void client.invalidateQueries({ queryKey: ['products'] });
              }}
            />
          )}
          {editable && (
            <button
              className="button primary full-button"
              onClick={() => {
                setEditing(selected);
                setSelected(null);
              }}
            >
              Edit product
            </button>
          )}
        </ProductDrawer>
      )}
      {editing !== undefined && (
        <ProductForm
          product={editing ?? undefined}
          categories={categories.data ?? []}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setSaved('Product saved.');
            void client.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
    </>
  );
}
function ImageUpload({ product, onSaved }: { product: Product; onSaved: (key: string) => void }) {
  const [error, setError] = useState('');
  const upload = useMutation({
    mutationFn: (file: File) =>
      request<{ imageKey: string }>('/products/' + product.id + '/image', {
        method: 'POST',
        body: file,
        headers: { 'Content-Type': file.type },
      }),
    onSuccess: (result) => onSaved(result.imageKey),
  });
  return (
    <label className="field">
      Product image (PNG, JPEG or WebP, maximum 2 MB)
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        disabled={upload.isPending}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (!file) return;
          setError('');
          if (file.size > 2 * 1024 * 1024) {
            setError('Image must be 2 MB or smaller');
            return;
          }
          upload.mutate(file);
        }}
      />
      {upload.isPending && <span role="status">Uploading…</span>}
      {(error || upload.error) && <span role="alert">{error || upload.error?.message}</span>}
    </label>
  );
}
