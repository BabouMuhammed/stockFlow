import { formatMoney } from '@stockflow/shared';
import { Dialog } from '../components/ui';
export type SaleLine = {
  id: string;
  productId: string;
  productName: string;
  productSku: string;
  quantity: string;
  unitPriceMinor: string;
  lineTotalMinor: string;
  discountMinor: string;
  unitCostMinor?: string;
};
export type SaleRecord = {
  id: string;
  receiptNumber: string;
  cashierName: string | null;
  createdAt: string;
  paymentMethod: string;
  subtotalMinor: string;
  discountMinor: string;
  totalMinor: string;
  amountReceivedMinor: string;
  changeMinor: string;
  receiptSnapshot: {
    businessName: string;
    phone?: string;
    address?: string;
    email?: string;
    header?: string;
    footer?: string;
    cashierName?: string;
  } | null;
  items: SaleLine[];
  returns: {
    id: string;
    refundMinor: string;
    reason: string;
    items: { saleItemId: string; quantity: string; restock: boolean }[];
  }[];
};
export default function Receipt({ sale, onClose }: { sale: SaleRecord; onClose: () => void }) {
  const business = sale.receiptSnapshot;
  return (
    <Dialog title="Sale receipt" onClose={onClose}>
      <div className="receipt-print">
        <header>
          <h2>{business?.businessName ?? 'Historical receipt'}</h2>
          <p>{business?.phone}</p>
          <p>{business?.address}</p>
          <p>{business?.email}</p>
          <p>{business?.header}</p>
        </header>
        <p>{sale.receiptNumber}</p>
        <p>
          {new Date(sale.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Banjul' })}{' '}
          (Africa/Banjul)
        </p>
        <p>Cashier: {business?.cashierName ?? sale.cashierName ?? 'Not recorded'}</p>
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Qty</th>
              <th>Price</th>
              <th>Amount</th>
            </tr>
          </thead>
          <tbody>
            {sale.items.map((i) => (
              <tr key={i.id}>
                <td>{i.productName}</td>
                <td>{i.quantity}</td>
                <td>{formatMoney(i.unitPriceMinor)}</td>
                <td>{formatMoney(i.lineTotalMinor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p>
          Subtotal <strong>{formatMoney(sale.subtotalMinor)}</strong>
        </p>
        <p>
          Discount <strong>{formatMoney(sale.discountMinor)}</strong>
        </p>
        <p>
          Total GMD <strong>{formatMoney(sale.totalMinor)}</strong>
        </p>
        <p>
          Payment: {sale.paymentMethod.replaceAll('_', ' ')}{' '}
          {sale.paymentMethod !== 'CASH' && '(manually recorded)'}
        </p>
        <p>
          Received <strong>{formatMoney(sale.amountReceivedMinor)}</strong>
        </p>
        <p>
          Change <strong>{formatMoney(sale.changeMinor)}</strong>
        </p>
        <footer>{business?.footer}</footer>
        {!business && <p>Business details were not snapshotted on this legacy sale.</p>}
      </div>
      <div className="modal-actions">
        <button className="button secondary" onClick={onClose}>
          Close
        </button>
        <button className="button primary" onClick={() => window.print()}>
          Print / Save as PDF
        </button>
      </div>
    </Dialog>
  );
}
