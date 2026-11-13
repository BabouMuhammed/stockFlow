import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Plus, Search } from '../components/icons';
import { StatusBadge } from '../components/retail';
import { request } from '../api';
import { Dialog, EmptyState, Notice } from '../components/ui';
import { QueryFeedback } from './catalogue';
import { useSession } from './session';
import { SupplierOverview } from './purchasing';
type RecordItem = {
  id: string;
  name: string;
  phone?: string | null;
  address?: string | null;
  isActive?: boolean;
  contactPerson?: string | null;
  email?: string | null;
  notes?: string;
};
const schema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(120),
  phone: z.string().max(40),
  address: z.string().max(240),
  isActive: z.boolean(),
  contactPerson: z.string().max(120),
  email: z.string().refine((v) => !v || z.email().safeParse(v).success, 'Enter a valid email'),
  notes: z.string().max(2000),
});
type Values = z.infer<typeof schema>;
function ReferenceForm({
  record,
  suppliers,
  onClose,
  onSaved,
}: {
  record?: RecordItem;
  suppliers: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const form = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      name: record?.name ?? '',
      phone: record?.phone ?? '',
      address: record?.address ?? '',
      isActive: record?.isActive ?? true,
      contactPerson: record?.contactPerson ?? '',
      email: record?.email ?? '',
      notes: record?.notes ?? '',
    },
  });
  const resource = suppliers ? 'supplier' : 'category';
  const mutation = useMutation({
    mutationFn: (values: Values) =>
      request('/' + (suppliers ? 'suppliers' : 'categories') + (record ? '/' + record.id : ''), {
        method: record ? 'PATCH' : 'POST',
        body: JSON.stringify(
          suppliers
            ? { ...values, email: values.email || null }
            : record
              ? { name: values.name, isActive: values.isActive }
              : { name: values.name },
        ),
      }),
    onSuccess: onSaved,
  });
  return (
    <Dialog title={(record ? 'Edit ' : 'Add ') + resource} onClose={onClose}>
      <form
        className="settings-form"
        noValidate
        onSubmit={form.handleSubmit((values) => mutation.mutate(values))}
      >
        <label className="field">
          Name
          <input
            {...form.register('name')}
            maxLength={suppliers ? 120 : 80}
            aria-invalid={!!form.formState.errors.name}
          />
          {form.formState.errors.name && (
            <small className="field-error" role="alert">
              {form.formState.errors.name.message}
            </small>
          )}
        </label>
        {suppliers && (
          <>
            <label className="field">
              Phone
              <input {...form.register('phone')} />
              {form.formState.errors.phone && (
                <small role="alert">{form.formState.errors.phone.message}</small>
              )}
            </label>
            <label className="field">
              Address
              <textarea {...form.register('address')} />
              {form.formState.errors.address && (
                <small role="alert">{form.formState.errors.address.message}</small>
              )}
            </label>
            <label className="field">
              Contact person
              <input {...form.register('contactPerson')} />
            </label>
            <label className="field">
              Email
              <input type="email" {...form.register('email')} />
              {form.formState.errors.email && (
                <small role="alert">{form.formState.errors.email.message}</small>
              )}
            </label>
            <label className="field">
              Notes
              <textarea {...form.register('notes')} />
            </label>
            <label className="check-field">
              <input type="checkbox" {...form.register('isActive')} />
              Active supplier
            </label>
          </>
        )}
        {!suppliers && record && (
          <label className="check-field">
            <input type="checkbox" {...form.register('isActive')} />
            Active category
          </label>
        )}
        {mutation.error && (
          <p role="alert" className="form-alert">
            {mutation.error.message}
          </p>
        )}
        <div className="modal-actions">
          <button className="button secondary" type="button" onClick={onClose}>
            Cancel
          </button>
          <button className="button primary" disabled={mutation.isPending}>
            {mutation.isPending ? 'Saving...' : 'Save ' + resource}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
export default function References({ suppliers = false }: { suppliers?: boolean }) {
  const { session } = useSession(),
    client = useQueryClient();
  const [editing, setEditing] = useState<RecordItem | null | undefined>(undefined),
    [search, setSearch] = useState(''),
    [saved, setSaved] = useState(false);
  const [supplierDetails, setSupplierDetails] = useState<string | null>(null);
  const key = suppliers ? 'suppliers' : 'categories';
  const editable = session?.user.role !== 'CASHIER';
  const query = useQuery({
    queryKey: [key, session?.business.id, session?.user.role],
    queryFn: () => request<RecordItem[]>('/' + key),
    enabled: !suppliers || editable,
  });
  if (suppliers && !editable)
    return <Notice>Supplier administration requires an owner or manager.</Notice>;
  const rows = (query.data ?? []).filter((r) =>
    r.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <>
      <div className="catalogue-toolbar">
        <label className="filter-search">
          <Search size={18} />
          <input
            aria-label={'Search ' + key}
            placeholder={'Search ' + key}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        {editable && (
          <button className="button primary" onClick={() => setEditing(null)}>
            <Plus size={16} />
            {suppliers ? 'Add supplier' : 'Add category'}
          </button>
        )}
      </div>
      {saved && <Notice>{suppliers ? 'Supplier' : 'Category'} saved.</Notice>}
      <QueryFeedback
        pending={query.isPending}
        error={query.error}
        retry={() => {
          void query.refetch();
        }}
      />
      {!query.isPending && !query.error && (
        <section className="panel">
          <div className="table-scroll">
            <table>
              <caption className="sr-only">
                {suppliers ? 'Suppliers' : 'Categories'} in your business
              </caption>
              <thead>
                <tr>
                  <th>Name</th>
                  {suppliers && (
                    <>
                      <th>Phone</th>
                      <th>Address</th>
                      <th>Status</th>
                    </>
                  )}
                  {editable && <th>Actions</th>}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td>
                      {r.name}
                      {r.isActive === false ? ' (archived)' : ''}
                    </td>
                    {suppliers && (
                      <>
                        <td>{r.phone || 'Not provided'}</td>
                        <td>{r.address || 'Not provided'}</td>
                        <td>
                          <StatusBadge tone={r.isActive ? 'success' : 'neutral'}>
                            {r.isActive ? 'Active' : 'Inactive'}
                          </StatusBadge>
                        </td>
                      </>
                    )}
                    {editable && (
                      <td>
                        <button className="quiet-action" onClick={() => setEditing(r)}>
                          Edit {r.name}
                        </button>
                        {suppliers && (
                          <button className="quiet-action" onClick={() => setSupplierDetails(r.id)}>
                            Purchases, payments & balance
                          </button>
                        )}
                        {suppliers && (
                          <Link className="text-link" to={'/inventory/receipts?supplierId=' + r.id}>
                            Stock receipts
                          </Link>
                        )}
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
            {!rows.length && (
              <EmptyState
                title={suppliers ? 'No suppliers found' : 'No categories found'}
                detail="Add a record or try a different search."
              />
            )}
          </div>
        </section>
      )}
      {editing !== undefined && (
        <ReferenceForm
          suppliers={suppliers}
          record={editing ?? undefined}
          onClose={() => setEditing(undefined)}
          onSaved={() => {
            setEditing(undefined);
            setSaved(true);
            void client.invalidateQueries({ queryKey: [key] });
            if (!suppliers) void client.invalidateQueries({ queryKey: ['products'] });
          }}
        />
      )}
      {supplierDetails && (
        <SupplierOverview id={supplierDetails} onClose={() => setSupplierDetails(null)} />
      )}
    </>
  );
}
