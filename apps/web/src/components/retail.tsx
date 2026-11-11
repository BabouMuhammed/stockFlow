import type { ReactNode } from 'react';
import { ArrowRight, LockKeyhole, Package, Plus, Minus, Trash2 } from './icons';
import ProductImage from './ProductImage';
import { Dialog } from './ui';

export function StatusBadge({
  children,
  tone = 'neutral',
}: {
  children: ReactNode;
  tone?: 'success' | 'warning' | 'neutral';
}) {
  return (
    <span className={'status-badge ' + tone}>
      <span />
      {children}
    </span>
  );
}

export function CategoryTabs({
  categories,
  value,
  onChange,
}: {
  categories: string[];
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <div className="category-tabs" role="group" aria-label="Product categories">
      {['', ...categories].map((category) => (
        <button
          key={category}
          className={value === category ? 'selected' : ''}
          aria-pressed={value === category}
          onClick={() => onChange(category)}
        >
          {category || 'All products'}
        </button>
      ))}
    </div>
  );
}

export function ProductCard({
  name,
  sku,
  category,
  price,
  availability,
  selected = 0,
  onSelect,
  pos = false,
  imageSource,
}: {
  name: string;
  sku: string;
  category: string;
  price: string;
  availability: string;
  selected?: number | string;
  onSelect: () => void;
  pos?: boolean;
  imageSource?: string;
}) {
  return (
    <button
      className={
        (pos ? 'pos-product' : 'catalogue-card') + (Number(selected) > 0 ? ' product-selected' : '')
      }
      onClick={onSelect}
    >
      <span className="product-art">
        <ProductImage name={name} source={imageSource} />
        {Number(selected) > 0 && <span className="selected-count">{selected} in cart</span>}
      </span>
      <span className="catalogue-card-body">
        <span className="product-code">{pos ? category : sku}</span>
        <h3>{name}</h3>
        <span className="product-card-bottom">
          <strong>{price}</strong>
          <span className="stock-label">{availability}</span>
        </span>
        {pos && (
          <span className="add-product">
            <Plus size={15} /> Add to cart
          </span>
        )}
      </span>
    </button>
  );
}

export function ProductDrawer({
  name,
  children,
  onClose,
  imageSource,
}: {
  name: string;
  children: ReactNode;
  onClose: () => void;
  imageSource?: string;
}) {
  return (
    <Dialog title={name} onClose={onClose} variant="drawer">
      <div className="product-detail-photo">
        <ProductImage name={name} source={imageSource} />
      </div>
      <span className="detail-overline">PRODUCT INFORMATION</span>
      {children}
    </Dialog>
  );
}

export function SummaryCard({
  label,
  value,
  note,
  children,
}: {
  label: string;
  value: ReactNode;
  note: string;
  children: ReactNode;
}) {
  return (
    <section className="stat-card">
      <div className="stat-top">
        <span className="stat-label">{label}</span>
        <span className="stat-icon">{children}</span>
      </div>
      <strong className="stat-value">{value}</strong>
      <span className="stat-note">{note}</span>
    </section>
  );
}

const unavailable = {
  Inventory: {
    columns: ['Product', 'SKU', 'Available stock', 'Low-stock status', 'Last updated'],
    action: 'Stock adjustment unavailable',
    detail:
      'Branch stock access is not assigned. Stock balances and movement history are unavailable.',
  },
  'Stock receipts': {
    columns: ['Reference', 'Supplier', 'Branch', 'Received on', 'Status'],
    action: 'Receive stock unavailable',
    detail: 'Supplier delivery recording and the incoming stock ledger are not enabled.',
  },
  'Stock counts': {
    columns: ['Count reference', 'Branch', 'Submitted by', 'Variance', 'Status'],
    action: 'New stock count unavailable',
    detail: 'Physical counts and independent approval are not enabled.',
  },
  'Sales history': {
    columns: ['Receipt', 'Date', 'Payment', 'Total (GMD)', 'Status'],
    action: 'Export unavailable',
    detail: 'Checkout and payment recording are not enabled. No sales have been invented.',
  },
  Reports: {
    columns: ['Report', 'Period', 'Data availability', 'Status'],
    action: 'Export reports unavailable',
    detail: 'Financial reports need completed sales, cost snapshots and verified stock records.',
  },
  Staff: {
    columns: ['Team member', 'Email', 'Role', 'Status'],
    action: 'Invite staff unavailable',
    detail:
      'Staff provisioning and branch assignments are not enabled. Existing sign-in remains available.',
  },
};

export function UnavailablePage({ title }: { title: string }) {
  const config = unavailable[title as keyof typeof unavailable];
  if (!config) return null;
  return (
    <section className="panel unavailable-page">
      <div className="panel-toolbar">
        <div>
          <h2>{title === 'Inventory' ? 'Stock overview' : title}</h2>
          <p>Business records</p>
        </div>
        <button className="button secondary" disabled>
          <LockKeyhole size={15} />
          {config.action}
        </button>
      </div>
      <div className="table-scroll" role="region" aria-label={title + ' table'} tabIndex={0}>
        <table>
          <thead>
            <tr>
              {config.columns.map((column) => (
                <th key={column}>{column}</th>
              ))}
            </tr>
          </thead>
        </table>
      </div>
      <div className="unavailable-content">
        <span className="unavailable-icon">
          <Package size={28} />
        </span>
        <StatusBadge>Unavailable</StatusBadge>
        <h3>Ready when your operations are connected</h3>
        <p>{config.detail}</p>
        <span className="unavailable-footnote">No records to display in this phase</span>
      </div>
      <div className="panel-footnote">
        <LockKeyhole size={14} />
        These operations are unavailable. Existing catalogue management is unchanged.
      </div>
    </section>
  );
}

export function CartItem({
  name,
  price,
  quantity,
  total,
  onDecrease,
  onIncrease,
  onRemove,
}: {
  name: string;
  price: string;
  quantity: number | string;
  total: string;
  onDecrease: () => void;
  onIncrease: () => void;
  onRemove: () => void;
}) {
  return (
    <div className="cart-line">
      <div className="cart-item-image">
        <ProductImage name={name} />
      </div>
      <div className="cart-line-main">
        <strong>{name}</strong>
        <span>{price} each</span>
        <strong className="cart-line-total">{total}</strong>
      </div>
      <button className="icon-button remove-line" aria-label={'Remove ' + name} onClick={onRemove}>
        <Trash2 size={15} />
      </button>
      <div className="cart-line-controls">
        <button aria-label={'Decrease ' + name} onClick={onDecrease}>
          <Minus size={14} />
        </button>
        <span>{quantity}</span>
        <button aria-label={'Increase ' + name} onClick={onIncrease}>
          <Plus size={14} />
        </button>
      </div>
    </div>
  );
}

export function SectionHeading({
  title,
  detail,
  children,
}: {
  title: string;
  detail?: string;
  children?: ReactNode;
}) {
  return (
    <div className="panel-heading">
      <div>
        <h2>{title}</h2>
        {detail && <p>{detail}</p>}
      </div>
      {children || <ArrowRight size={17} aria-hidden="true" />}
    </div>
  );
}
