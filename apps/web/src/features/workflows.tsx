import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ApiError, request } from '../api';
import { useSession } from './session';
import { QueryFeedback } from './catalogue';
import { EmptyState } from '../components/ui';
import { parseQuantityInput } from '@stockflow/shared';

// Mutations own their error messages; the synchronous guard also blocks rapid Enter/click retries.
export function useSubmitGuard() {
  const busy = useRef(false);
  return async (submit: () => Promise<unknown>) => {
    if (busy.current) return;
    busy.current = true;
    try {
      await submit();
    } catch {
      /* React Query exposes the error in the form. */
    } finally {
      busy.current = false;
    }
  };
}

export function useDebounced<T>(value: T, delay = 200) {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return settled;
}
export function useData<T>(key: string, path: string, enabled = true) {
  const { session } = useSession();
  return useQuery({
    queryKey: [key, session?.business.id, session?.user.id, session?.user.role, path],
    queryFn: ({ signal }) => request<T>(path, { signal }),
    enabled,
  });
}
export function ErrorMessage({ error }: { error: Error | null }) {
  return error ? (
    <div className="form-alert" role="alert">
      {error.message}
      {error instanceof ApiError && error.issues.length > 0 && (
        <ul>
          {error.issues.map((i) => (
            <li key={i.path}>
              {i.path}: {i.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  ) : null;
}
export type Page<T> = { data: T[]; total: number; page: number; limit: number };
export function Pager({
  page,
  total,
  limit = 25,
  onChange,
}: {
  page: number;
  total: number;
  limit?: number;
  onChange: (page: number) => void;
}) {
  return (
    <div className="pagination">
      <button className="button secondary" disabled={page <= 1} onClick={() => onChange(page - 1)}>
        Previous
      </button>
      <span>
        Page {page} · {total} records
      </span>
      <button
        className="button secondary"
        disabled={page * limit >= total}
        onClick={() => onChange(page + 1)}
      >
        Next
      </button>
    </div>
  );
}
export function DataTable({
  columns,
  rows,
  empty = 'No records yet',
}: {
  columns: string[];
  rows: ReactNode[][];
  empty?: string;
}) {
  return (
    <section className="panel">
      <div
        className="table-scroll"
        tabIndex={0}
        role="region"
        aria-label="Records table; scroll horizontally for more columns"
      >
        <table>
          <thead>
            <tr>
              {columns.map((c) => (
                <th key={c}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => (
              <tr key={i}>
                {row.map((cell, j) => (
                  <td key={j}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!rows.length && (
          <EmptyState title={empty} detail="New records will appear here after you save them." />
        )}
      </div>
    </section>
  );
}
export function Feedback({
  query,
}: {
  query: { isPending: boolean; error: Error | null; refetch: () => unknown };
}) {
  return (
    <QueryFeedback
      pending={query.isPending}
      error={query.error}
      retry={() => {
        void query.refetch();
      }}
    />
  );
}
export function Field({
  label,
  name,
  value,
  onChange,
  type = 'text',
  required = true,
  children,
}: {
  label: string;
  name?: string;
  value?: string;
  onChange?: (value: string) => void;
  type?: string;
  required?: boolean;
  children?: ReactNode;
}) {
  return (
    <label className="field">
      {label}
      {children ?? (
        <input
          name={name}
          value={value}
          onChange={onChange ? (e) => onChange(e.target.value) : undefined}
          type={type}
          required={required}
          step={type === 'number' ? '0.001' : undefined}
        />
      )}
    </label>
  );
}
export const paymentOptions = (
  <>
    <option value="CASH">Cash</option>
    <option value="BANK_TRANSFER">Bank transfer (manual record)</option>
    <option value="MOBILE_MONEY">Mobile money (manual record)</option>
    <option value="CARD">Card (manual record)</option>
  </>
);
export function MinorEstimate(price: string, quantity: string) {
  return (BigInt(price) * parseQuantityInput(quantity) + 500n) / 1000n;
}
