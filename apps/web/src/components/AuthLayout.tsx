import type { ReactNode } from 'react';
import { Boxes, Store } from './icons';

export default function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <main className="login-page">
      <section className="login-card" aria-label="StockFlow account">
        <div className="brand">
          <div className="brand-mark">
            <Store size={24} />
          </div>
          <strong>StockFlow</strong>
        </div>
        <p className="eyebrow">YOUR RETAIL WORKSPACE</p>
        {children}
      </section>
      <aside className="login-art" aria-label="About StockFlow">
        <h2>A clearer view of your everyday business.</h2>
        <p>
          Manage inventory, track sales, monitor expenses, and stay in control of your business.
        </p>
        <div
          className="inventory-illustration"
          role="img"
          aria-label="Illustrative inventory dashboard with fictional sales, stock levels and recent transactions"
        >
          <div className="illustration-heading">
            <span>
              <Boxes size={20} /> Inventory overview
            </span>
            <span>Illustrative preview</span>
          </div>
          <div className="illustration-summary">
            <div>
              <span>Today’s sales</span>
              <strong>D 4,750.00</strong>
            </div>
            <div>
              <span>Total products</span>
              <strong>128</strong>
            </div>
          </div>
          <div className="illustration-chart">
            <div>
              <strong>Sales this week</strong>
              <span>Fictional sample data</span>
            </div>
            <svg viewBox="0 0 400 110" aria-hidden="true">
              <path d="M0 100H400 M0 55H400 M0 10H400" stroke="#e3ece5" fill="none" />
              <path
                d="M5 90 L70 74 L135 79 L200 42 L265 51 L330 20 L395 10"
                stroke="#15803d"
                strokeWidth="3"
                fill="none"
                strokeLinejoin="round"
              />
            </svg>
            <div className="illustration-days">
              <span>Mon</span>
              <span>Tue</span>
              <span>Wed</span>
              <span>Thu</span>
              <span>Fri</span>
              <span>Sat</span>
              <span>Sun</span>
            </div>
          </div>
          <div className="illustration-stock">
            <strong>Low-stock alerts</strong>
            <span>3 products to review</span>
          </div>
          <div className="illustration-transactions">
            <strong>Recent transactions</strong>
            <div>
              <span>Sale #1042 · Cash</span>
              <span>D 661.25</span>
            </div>
            <div>
              <span>Sale #1041 · Cash</span>
              <span>D 390.50</span>
            </div>
          </div>
        </div>
      </aside>
    </main>
  );
}
