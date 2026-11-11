import type { ReactNode } from 'react';
import { ArrowRight, LockKeyhole, ShoppingCart, Smartphone, Wallet } from './icons';
import { StatusBadge } from './retail';

export default function CartPanel({
  children,
  count,
  total,
  payment,
  onPayment,
}: {
  children: ReactNode;
  count: number;
  total: string;
  payment: string;
  onPayment: (value: string) => void;
}) {
  return (
    <>
      <a className="mobile-cart-link" href="#cart-summary">
        <ShoppingCart size={19} />
        View cart ({count})<strong>{total}</strong>
        <ArrowRight size={17} />
      </a>
      <aside className="cart-panel" id="cart-summary" aria-label="Order summary">
        <div className="cart-heading">
          <div>
            <h2>Current order</h2>
            <p>
              {count} {count === 1 ? 'item' : 'items'} in your preview cart
            </p>
          </div>
          <StatusBadge>Preview</StatusBadge>
        </div>
        <div className="cart-lines" aria-live="polite" aria-relevant="additions removals">
          {children}
        </div>
        <div className="cart-checkout">
          <div className="subtotal-row">
            <span>Subtotal</span>
            <strong>{total}</strong>
          </div>
          <div className="total-row">
            <span>
              Total <small>(preview)</small>
            </span>
            <strong>{total}</strong>
          </div>
          <fieldset className="payment-fieldset">
            <legend>Payment method</legend>
            <div className="payment-options">
              {[
                { value: 'CASH', label: 'Cash', icon: Wallet },
                { value: 'MOBILE_MONEY', label: 'Mobile money', icon: Smartphone },
              ].map(({ value, label, icon: Icon }) => (
                <label
                  key={value}
                  className={'payment-option ' + (payment === value ? 'selected' : '')}
                >
                  <input
                    type="radio"
                    name="payment-method"
                    value={value}
                    checked={payment === value}
                    onChange={() => onPayment(value)}
                  />
                  <Icon size={18} />
                  <span>{label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <p className="cart-preview-note">
            {payment === 'MOBILE_MONEY'
              ? 'Manual recording is planned. No money is transferred.'
              : 'Temporary cart only. No payment is collected.'}
          </p>
          <button className="button primary full-button" disabled>
            <LockKeyhole size={16} />
            Checkout planned
          </button>
          <button className="button secondary full-button" disabled>
            Print receipt planned
          </button>
          <a className="return-products" href="#pos-products">
            Back to products
          </a>
        </div>
      </aside>
    </>
  );
}
