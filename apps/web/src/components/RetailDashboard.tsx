import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { demoProducts } from '@stockflow/shared';
import { request } from '../api';
import type { Category, ProductList } from '../features/catalogue';
import {
  ArrowRight,
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LockKeyhole,
  ShoppingCart,
  Tags,
} from './icons';
import { EmptyState } from './ui';
import { SectionHeading, StatusBadge, SummaryCard } from './retail';

export default function RetailDashboard({
  basePath = '',
  preview = false,
  scope = '',
}: {
  basePath?: string;
  preview?: boolean;
  scope?: string;
}) {
  const products = useQuery({
    queryKey: ['dashboard-products', scope],
    queryFn: () => request<ProductList>('/products?limit=1'),
    enabled: !preview,
  });
  const categories = useQuery({
    queryKey: ['dashboard-categories', scope],
    queryFn: () => request<Category[]>('/categories'),
    enabled: !preview,
  });
  const count = preview ? demoProducts.length : products.data?.total;
  const categoryCount = preview
    ? new Set(demoProducts.map((p) => p.category)).size
    : categories.data?.length;
  return (
    <>
      <div className="dashboard-intro">
        <div>
          <h2>Your store at a glance</h2>
          <p>Everything you need to keep your catalogue organised.</p>
        </div>
        <Link to={basePath + '/pos'} className="button primary">
          <ShoppingCart size={17} />
          Open point of sale
          <ArrowRight size={16} />
        </Link>
      </div>
      <div className="stats-grid">
        <SummaryCard
          label="Product catalogue"
          value={count ?? '—'}
          note={
            preview
              ? 'Illustrative products'
              : products.error
                ? 'Catalogue unavailable'
                : products.isPending
                  ? 'Loading catalogue'
                  : 'Products visible to your role'
          }
        >
          <Boxes size={19} />
        </SummaryCard>
        <SummaryCard
          label="Categories"
          value={categoryCount ?? '—'}
          note={
            preview
              ? 'Illustrative categories'
              : categories.error
                ? 'Categories unavailable'
                : categories.isPending
                  ? 'Loading categories'
                  : 'In your business catalogue'
          }
        >
          <Tags size={19} />
        </SummaryCard>
        <SummaryCard label="Sales revenue" value="—" note="Sales recording unavailable">
          <CreditCard size={19} />
        </SummaryCard>
        <SummaryCard label="Low-stock alerts" value="—" note="Branch stock access unavailable">
          <ClipboardList size={19} />
        </SummaryCard>
      </div>
      {(products.error || categories.error) && !preview && (
        <p role="alert" className="form-alert">
          Catalogue summary could not be loaded. Open Products to retry the catalogue request.
        </p>
      )}
      <div className="dashboard-grid">
        <section className="panel overview-panel sales-overview">
          <SectionHeading title="Sales overview" detail="Completed sales over time">
            <StatusBadge>Unavailable</StatusBadge>
          </SectionHeading>
          <div className="chart-unavailable">
            <BarChart3 size={26} />
            <strong>Your sales picture starts here</strong>
            <p>Sales recording and reporting are not connected yet.</p>
            <span>No financial figures are estimated</span>
          </div>
          <div className="chart-footnote">
            <LockKeyhole size={14} />
            Verified transactions are required to show this chart.
          </div>
        </section>
        <section className="panel overview-panel">
          <SectionHeading title="Inventory overview" detail="Availability across your store">
            <Boxes size={19} />
          </SectionHeading>
          <div className="inventory-metric">
            <span>Catalogue products</span>
            <strong>{count ?? '—'}</strong>
          </div>
          <div className="inventory-metric">
            <span>Available stock</span>
            <StatusBadge>Not connected</StatusBadge>
          </div>
          <div className="inventory-metric">
            <span>Low-stock status</span>
            <StatusBadge>Unavailable</StatusBadge>
          </div>
          <p className="section-description">
            {preview
              ? 'Sample quantities can be explored in the illustrative inventory.'
              : 'Stock levels need assigned branch access and inventory services.'}
          </p>
          <Link className="text-link inline-link" to={basePath + '/inventory'}>
            Review inventory
            <ArrowRight size={16} />
          </Link>
        </section>
      </div>
      <div className="foundation-grid">
        <section className="panel overview-panel">
          <SectionHeading title="Recent activity" detail="Completed sales and stock movements">
            <Link className="text-link" to={basePath + '/sales'}>
              View history
            </Link>
          </SectionHeading>
          <EmptyState
            title="Sales recording is planned"
            detail="Transactions and stock movements will appear here when those operations are available."
          />
        </section>
        <section className="panel overview-panel">
          <SectionHeading title="Quick access" detail="Go straight to your next task">
            <ArrowRight size={18} />
          </SectionHeading>
          {[
            {
              to: '/products',
              label: 'Manage products',
              detail: 'Catalogue and pricing',
              icon: Boxes,
            },
            {
              to: '/pos',
              label: 'Explore point of sale',
              detail: 'Temporary cart preview',
              icon: ShoppingCart,
            },
            {
              to: '/inventory/counts',
              label: 'Review stock counts',
              detail: 'Workflow unavailable',
              icon: ClipboardList,
            },
          ].map(({ to, label, detail, icon: Icon }) => (
            <Link className="quick-link" key={to} to={basePath + to}>
              <span className="quick-icon">
                <Icon size={19} />
              </span>
              <span>
                <strong>{label}</strong>
                <small>{detail}</small>
              </span>
              <ArrowRight size={16} />
            </Link>
          ))}
        </section>
      </div>
    </>
  );
}
