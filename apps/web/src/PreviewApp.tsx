import ProductImage, { ProductPhotoCredits } from './components/ProductImage';
import { useState } from 'react';
import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  Plus,
  Search,
  SlidersHorizontal,
  List,
  Grid2X2,
  Settings,
  ShoppingCart,
  Store,
} from './components/icons';
import { demoProducts, formatMoney, type DemoProduct } from '@stockflow/shared';
import { request } from './api';
import { EmptyState, Notice } from './components/ui';
import Login from './pages/PreviewLogin';
import WorkspaceShell from './components/WorkspaceShell';
import RetailDashboard from './components/RetailDashboard';
import {
  CartItem,
  CategoryTabs,
  ProductCard,
  ProductDrawer,
  StatusBadge,
  UnavailablePage,
} from './components/retail';
import CartPanel from './components/CartPanel';

const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/inventory', label: 'Inventory', icon: ArrowLeftRight },
  { to: '/inventory/receipts', label: 'Stock receipts', icon: ArrowDownToLine },
  { to: '/inventory/counts', label: 'Stock counts', icon: ClipboardList },
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart },
  { to: '/sales', label: 'Sales history', icon: CreditCard },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/staff', label: 'Staff', icon: Store },
  { to: '/settings', label: 'Settings', icon: Settings },
];
export default function PreviewApp({ basePath = '' }: { basePath?: string }) {
  const rawLocation = useLocation();
  const location = { ...rawLocation, pathname: rawLocation.pathname.slice(basePath.length) || '/' };
  const health = useQuery({
    queryKey: ['readiness'],
    queryFn: () => request<{ status: string }>('/health/ready'),
    retry: false,
    refetchInterval: 30000,
  });
  if (location.pathname === '/login') return <Login />;
  const title =
    navigation.find((item) => item.to === location.pathname)?.label ??
    (location.pathname === '/' ? 'Dashboard' : 'Page not found');
  return (
    <WorkspaceShell
      title={title}
      business="StockFlow Demo Mart"
      navigation={navigation}
      basePath={basePath}
      preview
      status={
        <div className="sidebar-status" role="status">
          <span className={'connection-dot ' + (health.isSuccess ? 'connected' : '')} />
          {health.isPending
            ? 'Checking database...'
            : health.isSuccess
              ? 'Database reachable'
              : 'Database not verified'}
        </div>
      }
      user={
        <Link to={basePath + '/login'} className="user-row">
          <div className="avatar">SF</div>
          <div className="user-meta">
            <strong>Illustrative workspace</strong>
            <span>No signed-in account</span>
          </div>
        </Link>
      }
    >
      <Notice>
        {title === 'Point of sale'
          ? 'Illustrative POS preview. Products, prices and quantities are sample data. Cart changes are temporary; checkout, payments and receipt printing are disabled.'
          : 'Illustrative preview. Sample products, prices and quantities are demonstration data. Transactions and account access are planned.'}
      </Notice>
      <Routes location={location}>
        <Route path="/" element={<Dashboard basePath={basePath} />} />
        <Route path="/dashboard" element={<Dashboard basePath={basePath} />} />
        <Route path="/products" element={<Catalogue />} />
        <Route path="/inventory" element={<Catalogue inventory />} />
        <Route path="/pos" element={<Pos />} />
        <Route
          path="/inventory/receipts"
          element={
            <Planned
              title="Stock receipts"
              detail="Supplier deliveries, purchase costs and the incoming stock ledger."
            />
          }
        />
        <Route
          path="/inventory/counts"
          element={
            <Planned
              title="Stock counts"
              detail="Physical counts, variance review and independent approval."
            />
          }
        />
        <Route
          path="/sales"
          element={
            <Planned
              title="Sales history"
              detail="Completed transactions, payment records and receipt lookups."
            />
          }
        />
        <Route
          path="/reports"
          element={
            <Planned
              title="Reports"
              detail="Daily, weekly and monthly revenue, cost of goods sold and estimated gross profit."
            />
          }
        />
        <Route path="/staff" element={<Staff />} />
        <Route path="/settings" element={<SettingsPage basePath={basePath} />} />
        <Route
          path="*"
          element={
            <section className="panel overview-panel">
              <h2>Page not found</h2>
              <Link className="text-link" to={basePath + '/dashboard'}>
                Return to dashboard
              </Link>
            </section>
          }
        />
      </Routes>
    </WorkspaceShell>
  );
}
function Dashboard({ basePath = '' }: { basePath?: string }) {
  return <RetailDashboard preview basePath={basePath} />;
}
function Catalogue({ inventory = false }: { inventory?: boolean }) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [selected, setSelected] = useState<DemoProduct | null>(null);
  const [view, setView] = useState<'grid' | 'table'>('table');
  const categories = [...new Set(demoProducts.map((p) => p.category))];
  const rows = demoProducts.filter(
    (p) =>
      (p.name + ' ' + p.sku).toLowerCase().includes(search.toLowerCase()) &&
      (!category || p.category === category),
  );
  return (
    <>
      <div className="catalogue-workspace">
        <aside className="catalogue-filters" aria-label="Catalogue filters">
          <h2>
            <SlidersHorizontal size={17} />
            Filters
          </h2>
          <label className="field" htmlFor="category">
            Category
            <select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">All categories</option>
              {categories.map((c) => (
                <option key={c}>{c}</option>
              ))}
            </select>
          </label>
          <div className="filter-info">
            <span>Stock availability</span>
            <StatusBadge>Sample quantities</StatusBadge>
            <p>Illustrative data, separate from your business records.</p>
          </div>
          <div className="filter-info">
            <span>Catalogue source</span>
            <p>Eight sample retail products. No live stock is shown.</p>
          </div>
          <button
            className="text-link reset-filters"
            onClick={() => {
              setSearch('');
              setCategory('');
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
                placeholder="Search products or SKU..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
            <button className="button primary" disabled>
              <Plus size={17} />
              Add product unavailable
            </button>
          </div>
          <div className="catalogue-heading">
            <div>
              <h2>{inventory ? 'Stock overview' : 'Product catalogue'}</h2>
              <span>{rows.length} illustrative products</span>
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
          {!rows.length ? (
            <section className="panel">
              <EmptyState
                title="No matching products"
                detail="Try a different product name or category."
              />
            </section>
          ) : view === 'grid' ? (
            <div className="catalogue-grid">
              {rows.map((p) => (
                <ProductCard
                  key={p.sku}
                  name={p.name}
                  sku={p.sku}
                  category={p.category}
                  price={formatMoney(p.price)}
                  availability={p.quantity.replace(/\.000$/, '') + ' sample units'}
                  onSelect={() => setSelected(p)}
                />
              ))}
            </div>
          ) : (
            <section className="panel catalogue-table">
              <div
                className="table-scroll"
                role="region"
                aria-label="Illustrative product table"
                tabIndex={0}
              >
                <table>
                  <caption className="sr-only">
                    Illustrative product prices and stock quantities
                  </caption>
                  <thead>
                    <tr>
                      <th>Product</th>
                      <th>SKU / barcode</th>
                      <th>Category</th>
                      <th>Sample cost</th>
                      <th>Price (GMD)</th>
                      <th>Sample quantity</th>
                      <th>Status</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr key={p.sku}>
                        <td>
                          <div className="product-table-name">
                            <span className="table-product-image">
                              <ProductImage name={p.name} />
                            </span>
                            <h3>
                              <button className="quiet-action" onClick={() => setSelected(p)}>
                                {p.name}
                              </button>
                            </h3>
                          </div>
                        </td>
                        <td>
                          <span className="sku-text">{p.sku}</span>
                          <small className="cell-subtext">No sample barcode</small>
                        </td>
                        <td>{p.category}</td>
                        <td>{formatMoney(p.cost)}</td>
                        <td className="money-cell">{formatMoney(p.price)}</td>
                        <td>
                          {p.quantity}
                          <small className="cell-subtext">
                            Illustrative; low-stock status unavailable
                          </small>
                        </td>
                        <td>
                          <StatusBadge>Sample</StatusBadge>
                        </td>
                        <td>
                          <button className="quiet-action" onClick={() => setSelected(p)}>
                            View details<span className="sr-only"> for {p.name}</span>
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}
          {rows.length > 0 && <ProductPhotoCredits />}
          <div className="catalogue-pagination">
            <span>
              Showing {rows.length} of {demoProducts.length} sample products
            </span>
            <span className="page-number">1</span>
          </div>
        </section>
      </div>
      {selected && (
        <ProductDrawer name={selected.name} onClose={() => setSelected(null)}>
          <p className="eyebrow">ILLUSTRATIVE PRODUCT</p>
          <dl className="product-detail">
            <dt>SKU</dt>
            <dd>{selected.sku}</dd>
            <dt>Category</dt>
            <dd>{selected.category}</dd>
            <dt>Selling price</dt>
            <dd>{formatMoney(selected.price)}</dd>
            <dt>Sample quantity</dt>
            <dd>{selected.quantity}</dd>
          </dl>
          <Notice>Product editing and live inventory will be available in a later phase.</Notice>
          <button className="button primary full-button" onClick={() => setSelected(null)}>
            Done
          </button>
        </ProductDrawer>
      )}
    </>
  );
}
function Pos() {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [cart, setCart] = useState<{ product: DemoProduct; quantity: number }[]>([]);
  const [payment, setPayment] = useState('CASH');
  const add = (product: DemoProduct) =>
    setCart((current) => {
      const line = current.find((l) => l.product.sku === product.sku);
      if (line && line.quantity >= Number(product.quantity)) return current;
      return line
        ? current.map((l) =>
            l.product.sku === product.sku ? { ...l, quantity: l.quantity + 1 } : l,
          )
        : [...current, { product, quantity: 1 }];
    });
  const total = cart.reduce((sum, l) => sum + l.product.price * l.quantity, 0);
  const rows = demoProducts.filter(
    (p) =>
      (p.name + ' ' + p.sku).toLowerCase().includes(search.toLowerCase()) &&
      (!category || p.category === category),
  );
  return (
    <>
      <div className="pos-layout">
        <section className="pos-products" id="pos-products">
          <div className="pos-section-heading">
            <div>
              <h2>Find your products</h2>
              <p>Select an item to add it to your preview cart.</p>
            </div>
            <label className="filter-search">
              <Search size={19} />
              <input
                aria-label="Search POS products"
                placeholder="Search product name or SKU"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <CategoryTabs
            categories={[...new Set(demoProducts.map((p) => p.category))]}
            value={category}
            onChange={setCategory}
          />
          <div className="pos-product-grid">
            {rows.map((p) => (
              <ProductCard
                key={p.sku}
                name={p.name}
                sku={p.sku}
                category={p.category}
                price={formatMoney(p.price)}
                availability={p.quantity.replace(/\.000$/, '') + ' sample units'}
                selected={cart.find((l) => l.product.sku === p.sku)?.quantity}
                onSelect={() => add(p)}
                pos
              />
            ))}
          </div>
          {!rows.length && (
            <EmptyState title="No matching products" detail="Try another search or category." />
          )}
          <ProductPhotoCredits />
        </section>
        <CartPanel
          count={cart.reduce((sum, l) => sum + l.quantity, 0)}
          total={formatMoney(total)}
          payment={payment}
          onPayment={setPayment}
        >
          {!cart.length ? (
            <EmptyState
              title="Start with a product"
              detail="Select an illustrative item to explore the cart."
            />
          ) : (
            cart.map((l) => (
              <CartItem
                key={l.product.sku}
                name={l.product.name}
                price={formatMoney(l.product.price)}
                quantity={l.quantity}
                total={formatMoney(l.quantity * l.product.price)}
                onIncrease={() => add(l.product)}
                onDecrease={() =>
                  setCart((c) =>
                    c.flatMap((x) =>
                      x.product.sku !== l.product.sku
                        ? [x]
                        : x.quantity > 1
                          ? [{ ...x, quantity: x.quantity - 1 }]
                          : [],
                    ),
                  )
                }
                onRemove={() => setCart((c) => c.filter((x) => x.product.sku !== l.product.sku))}
              />
            ))
          )}
        </CartPanel>
      </div>
    </>
  );
}
function Planned({ title }: { title: string; detail: string }) {
  return <UnavailablePage title={title} />;
}
function Staff() {
  return (
    <section className="panel overview-panel">
      <h2>Access built around your team</h2>
      <p className="section-description">
        Role policy is defined. Staff accounts and invitations are planned.
      </p>
      <div className="roles-grid">
        {[
          { name: 'Owner', text: 'Full access within their business.' },
          {
            name: 'Manager',
            text: 'Inventory, operational reports and permitted staff operations.',
          },
          { name: 'Cashier', text: 'Checkout and explicitly permitted transaction lookups.' },
        ].map((r) => (
          <article key={r.name}>
            <Store size={25} />
            <h3>{r.name}</h3>
            <p>{r.text}</p>
          </article>
        ))}
      </div>
    </section>
  );
}
function SettingsPage({ basePath = '' }: { basePath?: string }) {
  return (
    <div className="settings-layout">
      <section className="panel overview-panel">
        <h2>Workspace preferences</h2>
        <p className="section-description">Illustrative settings · saving is planned.</p>
        <div className="settings-form">
          <label className="field">
            Business name
            <input value="StockFlow Demo Mart (illustrative)" readOnly />
          </label>
          <label className="field">
            Branch
            <input value="Serrekunda (illustrative)" readOnly />
          </label>
          <label className="field">
            Currency
            <input value="GMD · Gambian dalasi" readOnly />
          </label>
          <button className="button primary" disabled>
            Save settings planned
          </button>
        </div>
      </section>
      <aside className="settings-notes">
        <h3>A local foundation</h3>
        <p>
          Session authentication, backups and operational controls are documented for subsequent
          implementation.
        </p>
        <Link className="text-link" to={basePath + '/login'}>
          View sign-in preview →
        </Link>
      </aside>
    </div>
  );
}
