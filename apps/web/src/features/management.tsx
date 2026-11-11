import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { formatMoney, moneyInputValue, parseMoneyInput } from '@stockflow/shared';
import { request } from '../api';
import { Dialog, Notice } from '../components/ui';
import { useSession } from './session';
import {
  DataTable,
  ErrorMessage,
  Feedback,
  Field,
  Pager,
  paymentOptions,
  useData,
  useDebounced,
  type Page,
} from './workflows';
type Employee = { id: string; name: string; email: string; role: string; isActive: boolean };
export function Employees() {
  const client = useQueryClient(),
    query = useData<Employee[]>('staff', '/staff');
  const [editing, setEditing] = useState<Employee | null | undefined>(),
    [saved, setSaved] = useState('');
  const [formError, setFormError] = useState('');
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) =>
      request('/staff' + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setEditing(undefined);
      setSaved('Employee access saved. Changed accounts must sign in again.');
      await client.invalidateQueries();
    },
  });
  const activity = useData<
    Page<{ id: string; action: string; user: { name: string } | null; createdAt: string }>
  >('activity', '/staff/activity?limit=10');
  return (
    <>
      <div className="catalogue-toolbar">
        <p>Only the owner can manage staff access.</p>
        <button
          className="button primary"
          onClick={() => {
            mutation.reset();
            setEditing(null);
            setFormError('');
          }}
        >
          Create employee
        </button>
      </div>
      {saved && <Notice>{saved}</Notice>}
      <Feedback query={query} />
      {query.data && (
        <DataTable
          columns={['Name', 'Email', 'Role', 'Status', 'Access']}
          rows={query.data.map((u) => [
            u.name,
            u.email,
            u.role,
            u.isActive ? 'Active' : 'Inactive',
            u.role === 'OWNER' ? (
              'Owner account'
            ) : (
              <button
                className="quiet-action"
                onClick={() => {
                  mutation.reset();
                  setEditing(u);
                }}
              >
                Edit access
              </button>
            ),
          ])}
        />
      )}
      {activity.data && (
        <>
          <h2>Recent employee activity</h2>
          <DataTable
            columns={['Action', 'User', 'Date']}
            rows={activity.data.data.map((a) => [
              a.action,
              a.user?.name ?? 'System',
              new Date(a.createdAt).toLocaleString('en-GB', { timeZone: 'Africa/Banjul' }),
            ])}
          />
        </>
      )}
      {editing !== undefined && (
        <Dialog
          title={editing ? 'Edit employee access' : 'Create employee'}
          onClose={() => setEditing(undefined)}
        >
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              setFormError('');
              const data = new FormData(e.currentTarget);
              const password = String(data.get('password'));
              if (password && password.length < 12) {
                setFormError('Use at least 12 characters');
                return;
              }
              mutation.mutate({
                id: editing?.id,
                body: {
                  name: data.get('name'),
                  role: data.get('role'),
                  ...(editing
                    ? { isActive: data.get('active') === 'on' }
                    : { email: data.get('email') }),
                  ...(password ? { password } : {}),
                },
              });
            }}
          >
            <label className="field">
              Name
              <input name="name" required defaultValue={editing?.name} />
            </label>
            {!editing && <Field label="Email address" name="email" type="email" />}
            <Field label="Role">
              <select name="role" defaultValue={editing?.role ?? 'CASHIER'}>
                <option value="CASHIER">Cashier</option>
                <option value="MANAGER">Manager</option>
              </select>
            </Field>
            <Field
              label={
                editing
                  ? 'New password (leave empty to keep current access)'
                  : 'Initial password (12+ characters)'
              }
              name="password"
              type="password"
              required={!editing}
            />
            {editing && (
              <label className="check-field">
                <input type="checkbox" name="active" defaultChecked={editing.isActive} />
                Active account
              </label>
            )}
            {formError && <p role="alert">{formError}</p>}
            <ErrorMessage error={mutation.error} />
            <button className="button primary" disabled={mutation.isPending}>
              Save employee access
            </button>
          </form>
        </Dialog>
      )}
    </>
  );
}
type Customer = {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  notes: string;
};
type Expense = {
  id: string;
  title: string;
  category: string;
  amountMinor: string;
  date: string;
  description: string;
  paymentMethod: string;
};
export function BusinessRecords({ expenses = false }: { expenses?: boolean }) {
  const client = useQueryClient(),
    { session } = useSession(),
    key = expenses ? 'expenses' : 'customers';
  const [search, setSearch] = useState(''),
    [page, setPage] = useState(1),
    [from, setFrom] = useState(''),
    [to, setTo] = useState(''),
    [category, setCategory] = useState('');
  const [editing, setEditing] = useState<Customer | Expense | null | undefined>(),
    [error, setError] = useState(''),
    [saved, setSaved] = useState(''),
    [history, setHistory] = useState<Customer | null>(null);
  const params = new URLSearchParams({ search: useDebounced(search), page: String(page) });
  if (expenses) {
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    if (category) params.set('category', category);
  }
  const customers = useData<Page<Customer>>('customers', '/customers?' + params, !expenses),
    costs = useData<Page<Expense> & { totalMinor: string }>(
      'expenses',
      '/expenses?' + params,
      expenses,
    );
  const historyQuery = useData<
    Page<{ id: string; receiptNumber: string; totalMinor: string; createdAt: string }>
  >('customer-history', '/customers/' + history?.id + '/sales', !!history);
  const query = expenses ? costs : customers;
  const mutation = useMutation({
    mutationFn: ({ id, body }: { id?: string; body: unknown }) =>
      request('/' + key + (id ? '/' + id : ''), {
        method: id ? 'PATCH' : 'POST',
        body: JSON.stringify(body),
      }),
    onSuccess: async () => {
      setEditing(undefined);
      setSaved('Record saved.');
      await client.invalidateQueries();
    },
  });
  const expense = editing && 'amountMinor' in editing ? editing : null,
    customer = editing && 'name' in editing ? editing : null;
  return (
    <>
      <div className="catalogue-toolbar">
        <Field
          label={'Search ' + key}
          value={search}
          onChange={(v) => {
            setSearch(v);
            setPage(1);
          }}
          required={false}
        />
        <button
          className="button primary"
          onClick={() => {
            mutation.reset();
            setError('');
            setEditing(null);
          }}
        >
          {expenses ? 'Add expense' : 'Register customer'}
        </button>
      </div>
      {expenses && (
        <>
          <Notice>
            Record operating costs here. Receive inventory purchases through Stock receipts to keep
            them separate from operating expenses.
          </Notice>
          <div className="report-filters">
            <Field
              label="From"
              type="date"
              value={from}
              onChange={(v) => {
                setFrom(v);
                setPage(1);
              }}
              required={false}
            />
            <Field
              label="To"
              type="date"
              value={to}
              onChange={(v) => {
                setTo(v);
                setPage(1);
              }}
              required={false}
            />
            <Field
              label="Expense category filter"
              value={category}
              onChange={(v) => {
                setCategory(v);
                setPage(1);
              }}
              required={false}
            />
          </div>
          {costs.data && (
            <p>
              Filtered operating expenses: <strong>{formatMoney(costs.data.totalMinor)}</strong>
            </p>
          )}
        </>
      )}
      {saved && <Notice>{saved}</Notice>}
      <Feedback query={query} />
      {!query.error &&
        !query.isPending &&
        (expenses ? (
          <DataTable
            columns={['Title', 'Category', 'Date', 'Amount', 'Payment', 'Action']}
            rows={(costs.data?.data ?? []).map((e) => [
              e.title,
              e.category,
              e.date.slice(0, 10),
              formatMoney(e.amountMinor),
              e.paymentMethod,
              <button
                className="quiet-action"
                onClick={() => {
                  mutation.reset();
                  setEditing(e);
                }}
              >
                Edit
              </button>,
            ])}
          />
        ) : (
          <DataTable
            columns={['Name', 'Phone', 'Email', 'Actions']}
            rows={(customers.data?.data ?? []).map((c) => [
              c.name,
              c.phone ?? '—',
              c.email ?? '—',
              <div className="workflow-links">
                <button className="quiet-action" onClick={() => setHistory(c)}>
                  Purchase history
                </button>
                {session?.user.role !== 'CASHIER' && (
                  <button
                    className="quiet-action"
                    onClick={() => {
                      mutation.reset();
                      setEditing(c);
                    }}
                  >
                    Edit
                  </button>
                )}
              </div>,
            ])}
          />
        ))}
      {query.data && <Pager page={page} total={query.data.total} onChange={setPage} />}
      {editing !== undefined && (
        <Dialog
          title={expenses ? 'Operating expense' : 'Customer details'}
          onClose={() => setEditing(undefined)}
        >
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              setError('');
              try {
                const data = new FormData(e.currentTarget),
                  body = expenses
                    ? {
                        title: data.get('title'),
                        category: data.get('category'),
                        amountMinor: parseMoneyInput(String(data.get('amount'))),
                        date: data.get('date'),
                        description: data.get('description'),
                        paymentMethod: data.get('paymentMethod'),
                      }
                    : {
                        name: data.get('name'),
                        phone: data.get('phone') || null,
                        email: data.get('email') || null,
                        address: data.get('address') || null,
                        notes: data.get('notes'),
                      };
                mutation.mutate({ id: editing?.id, body });
              } catch (err) {
                setError(err instanceof Error ? err.message : 'Check your fields');
              }
            }}
          >
            {expenses ? (
              <>
                <label className="field">
                  Expense title
                  <input name="title" required defaultValue={expense?.title} />
                </label>
                <label className="field">
                  Category
                  <input
                    name="category"
                    required
                    list="expense-categories"
                    defaultValue={expense?.category}
                  />
                  <datalist id="expense-categories">
                    {[
                      'Rent',
                      'Electricity',
                      'Water',
                      'Transportation',
                      'Staff salaries',
                      'Internet',
                      'Maintenance',
                      'Cleaning',
                      'Miscellaneous',
                    ].map((v) => (
                      <option key={v}>{v}</option>
                    ))}
                  </datalist>
                </label>
                <label className="field">
                  Amount (GMD)
                  <input
                    name="amount"
                    required
                    defaultValue={expense ? moneyInputValue(expense.amountMinor) : ''}
                  />
                </label>
                <label className="field">
                  Date
                  <input
                    name="date"
                    type="date"
                    required
                    defaultValue={
                      expense?.date.slice(0, 10) ?? new Date().toISOString().slice(0, 10)
                    }
                  />
                </label>
                <label className="field">
                  Description
                  <textarea name="description" defaultValue={expense?.description} />
                </label>
                <Field label="Payment method">
                  <select name="paymentMethod" defaultValue={expense?.paymentMethod ?? 'CASH'}>
                    {paymentOptions}
                  </select>
                </Field>
              </>
            ) : (
              <>
                {[
                  ['name', 'Customer name', customer?.name],
                  ['phone', 'Phone', customer?.phone],
                  ['email', 'Email', customer?.email],
                  ['address', 'Address', customer?.address],
                  ['notes', 'Notes', customer?.notes],
                ].map(([name, label, value]) => (
                  <label key={name} className="field">
                    {label}
                    <input
                      name={name!}
                      required={name === 'name'}
                      type={name === 'email' ? 'email' : 'text'}
                      defaultValue={value ?? ''}
                    />
                  </label>
                ))}
              </>
            )}
            {error && (
              <p role="alert" className="form-alert">
                {error}
              </p>
            )}
            <ErrorMessage error={mutation.error} />
            <button className="button primary" disabled={mutation.isPending}>
              Save {expenses ? 'expense' : 'customer'}
            </button>
          </form>
        </Dialog>
      )}
      {history && (
        <Dialog title={'Purchase history · ' + history.name} onClose={() => setHistory(null)}>
          <Feedback query={historyQuery} />
          {historyQuery.data && (
            <DataTable
              columns={['Receipt', 'Date', 'Total']}
              rows={historyQuery.data.data.map((s) => [
                s.receiptNumber,
                s.createdAt.slice(0, 10),
                formatMoney(s.totalMinor),
              ])}
            />
          )}
        </Dialog>
      )}
    </>
  );
}
type Settings = {
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  receiptHeader: string;
  receiptFooter: string;
  defaultLowStockThreshold: string;
};
export function SettingsPage() {
  const { session, refresh } = useSession(),
    client = useQueryClient(),
    query = useData<Settings>('settings', '/settings', session?.user.role === 'OWNER');
  const [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: ({ path, body }: { path: string; body: unknown }) =>
      request(path, {
        method: path === '/account/password' ? 'POST' : 'PATCH',
        body: JSON.stringify(body),
      }),
    onSuccess: async (_data, variables) => {
      setNotice(
        variables.path === '/account/password'
          ? 'Password changed. Sign in again.'
          : 'Settings saved.',
      );
      await client.invalidateQueries();
      refresh();
    },
  });
  const revoke = useMutation({
    mutationFn: () => request('/account/sessions/revoke', { method: 'POST', body: '{}' }),
    onSuccess: () => setNotice('Other sessions revoked.'),
  });
  return (
    <>
      {notice && <Notice>{notice}</Notice>}
      <ErrorMessage error={mutation.error} />
      {session?.user.role === 'OWNER' && (
        <>
          <Feedback query={query} />
          {query.data && (
            <section className="panel overview-panel">
              <h2>Business and receipts</h2>
              <form
                className="form-grid"
                key={query.data.name}
                onSubmit={(e) => {
                  e.preventDefault();
                  const fields = Object.fromEntries(new FormData(e.currentTarget));
                  mutation.mutate({
                    path: '/settings',
                    body: { ...fields, email: fields.email || null },
                  });
                }}
              >
                {Object.entries({
                  name: 'Business name',
                  phone: 'Business phone',
                  email: 'Business email',
                  address: 'Business address',
                  receiptHeader: 'Receipt header',
                  receiptFooter: 'Receipt footer',
                  defaultLowStockThreshold: 'Default low-stock threshold',
                }).map(([name, label]) => (
                  <label key={name} className="field">
                    {label}
                    <input
                      name={name}
                      defaultValue={String(query.data![name as keyof Settings] ?? '')}
                      required={name === 'name' || name === 'defaultLowStockThreshold'}
                    />
                  </label>
                ))}
                <p>Currency: GMD · Timezone: Africa/Banjul</p>
                <button className="button primary" disabled={mutation.isPending}>
                  Save business settings
                </button>
              </form>
            </section>
          )}
        </>
      )}
      <section className="panel overview-panel">
        <h2>Your account</h2>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              path: '/account',
              body: Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          <label className="field">
            Your full name
            <input name="name" required defaultValue={session?.user.name} />
          </label>
          <button className="button secondary" disabled={mutation.isPending}>
            Update profile
          </button>
        </form>
        <form
          className="settings-form"
          onSubmit={(e) => {
            e.preventDefault();
            mutation.mutate({
              path: '/account/password',
              body: Object.fromEntries(new FormData(e.currentTarget)),
            });
          }}
        >
          <Field label="Current password" name="currentPassword" type="password" />
          <Field label="New password (12+ characters)" name="password" type="password" />
          <button className="button secondary" disabled={mutation.isPending}>
            Change password
          </button>
        </form>
        <button
          className="button secondary"
          disabled={revoke.isPending}
          onClick={() => revoke.mutate()}
        >
          Revoke other sessions
        </button>
        <ErrorMessage error={revoke.error} />
      </section>
    </>
  );
}
