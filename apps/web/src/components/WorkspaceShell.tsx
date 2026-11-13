import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { Link, NavLink } from 'react-router-dom';
import { CalendarDays, Menu, Store, X } from './icons';

export type NavigationItem = {
  to: string;
  label: string;
  icon: LucideIcon;
};
const descriptions: Record<string, string> = {
  Dashboard: 'A clear view of your store and daily operations.',
  Products: 'Manage your catalogue, prices and product details.',
  'Point of sale': 'Find a product. Build an order. Keep your day moving.',
  Inventory: 'Review stock availability and inventory operations.',
  'Stock receipts': 'Keep track of incoming stock and supplier deliveries.',
  'Stock counts': 'Review physical counts and inventory differences.',
  'Stock history': 'Review audited inventory movements and their reasons.',
  Categories: 'Keep your product catalogue organised.',
  Suppliers: 'Your supplier directory, in one place.',
  'Sales history': 'Review completed sales and payment records.',
  Reports: 'Understand your store with verified business data.',
  Staff: 'Workspace access and team permissions.',
  Settings: 'Business information and workspace preferences.',
  Expenses: 'Record operating costs and keep expense history.',
  Customers: 'Customer details and purchase history.',
};

export default function WorkspaceShell({
  title,
  business,
  navigation,
  basePath = '',
  preview = false,
  status,
  user,
  children,
}: {
  title: string;
  business: string;
  navigation: NavigationItem[];
  basePath?: string;
  preview?: boolean;
  status: ReactNode;
  user: ReactNode;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const [mobile, setMobile] = useState(() => window.innerWidth <= 760);
  const sidebar = useRef<HTMLElement>(null);
  const content = useRef<HTMLDivElement>(null);
  const menuId = useId();
  useEffect(() => {
    if (!window.matchMedia) return;
    const query = window.matchMedia('(max-width: 760px)');
    const update = () => {
      setMobile(query.matches);
      if (!query.matches) setOpen(false);
    };
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!open || !mobile) return;
    const previous = document.activeElement as HTMLElement | null;
    const background = content.current!;
    const oldInert = background.inert;
    const oldOverflow = document.body.style.overflow;
    background.inert = true;
    document.body.style.overflow = 'hidden';
    const controls = () =>
      Array.from(
        sidebar.current!.querySelectorAll<HTMLElement>(
          'a[href], button:not(:disabled), [tabindex="0"]',
        ),
      );
    controls()[0]?.focus();
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false);
      }
      if (event.key !== 'Tab') return;
      const items = controls();
      const first = items[0],
        last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      } else if (!sidebar.current?.contains(document.activeElement)) {
        event.preventDefault();
        first?.focus();
      }
    };
    document.addEventListener('keydown', keydown);
    return () => {
      document.removeEventListener('keydown', keydown);
      background.inert = oldInert;
      document.body.style.overflow = oldOverflow;
      previous?.focus();
    };
  }, [open, mobile]);
  return (
    <div className={'app-shell' + (title === 'Point of sale' ? ' pos-shell' : '')}>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      {open && (
        <button
          className="sidebar-shade"
          aria-label="Close navigation"
          onClick={() => setOpen(false)}
        />
      )}
      <aside
        ref={sidebar}
        id={menuId}
        role={mobile && open ? 'dialog' : undefined}
        aria-modal={mobile && open ? true : undefined}
        className={'sidebar ' + (open ? 'sidebar-open' : '')}
        aria-label="Workspace navigation"
        onKeyDown={(event) => {
          if (event.key === 'Escape') setOpen(false);
        }}
      >
        {open && (
          <button
            className="icon-button drawer-close"
            aria-label="Close menu"
            onClick={() => setOpen(false)}
          >
            <X size={22} />
          </button>
        )}
        <Link
          to={basePath + '/dashboard'}
          onClick={() => setOpen(false)}
          className="brand"
          aria-label="StockFlow dashboard"
        >
          <div className="brand-mark">
            <Store size={24} />
          </div>
          <div className="brand-copy">
            <strong>StockFlow</strong>
            <span>RETAIL WORKSPACE</span>
          </div>
        </Link>
        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          {navigation.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={basePath + to}
              end
              title={label}
              className={({ isActive }) => 'nav-link ' + (isActive ? 'active' : '')}
              onClick={() => setOpen(false)}
            >
              <Icon size={21} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-bottom">{user}</div>
      </aside>
      <div className="main-column" ref={content}>
        <header className="topbar">
          <button
            className="icon-button mobile-menu"
            onClick={() => setOpen(!open)}
            aria-label={open ? 'Close navigation' : 'Open navigation'}
            aria-expanded={open}
            aria-controls={menuId}
          >
            {open ? <X size={21} /> : <Menu size={21} />}
          </button>
          <div className="topbar-store">
            <Store size={19} />
            <strong>{business}</strong>
            <span className="topbar-divider" />
            <span className="workspace-location">The Gambia</span>
          </div>
          <div className="topbar-right">
            <span className="top-date">
              <CalendarDays size={15} />
              {new Intl.DateTimeFormat('en-GB', {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              }).format(new Date())}
            </span>
            {preview && <span className="preview-chip">DEMO PREVIEW</span>}
          </div>
        </header>
        <main className="page-content" id="main">
          <div className="breadcrumb">
            <span>Workspace</span>
            <span>/</span>
            <strong>{title}</strong>
          </div>
          <div className="page-heading">
            <div>
              <h1>{title}</h1>
              <p>{descriptions[title]}</p>
            </div>
            <span className="currency-chip">
              GMD <span>Gambian dalasi</span>
            </span>
          </div>
          {children}
        </main>
        <footer className="workspace-footer">
          <span>
            StockFlow <span className="footer-separator">/</span>{' '}
            {preview ? 'Illustrative workspace' : 'Retail operations'}
          </span>
          {status}
        </footer>
      </div>
    </div>
  );
}
