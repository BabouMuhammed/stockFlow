import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useSession } from '../features/session';
import { ErrorMessage } from '../features/workflows';
export default function Register() {
  const { registerBusiness } = useSession();
  const mutation = useMutation({ mutationFn: registerBusiness });
  return (
    <main className="login-page">
      <section className="login-card">
        <p className="eyebrow">STOCKFLOW</p>
        <h1>Register your business</h1>
        <p>Start with an empty workspace for your shop. Prices and receipts use Gambian dalasi.</p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = new FormData(e.currentTarget);
            mutation.mutate(Object.fromEntries(form) as Record<string, string>);
          }}
        >
          {[
            ['businessName', 'Business name', 'text'],
            ['name', 'Owner’s full name', 'text'],
            ['email', 'Email address', 'email'],
            ['phone', 'Phone number', 'tel'],
            ['address', 'Business address (optional)', 'text'],
            ['password', 'Password', 'password'],
            ['passwordConfirmation', 'Confirm password', 'password'],
          ].map(([name, label, type]) => (
            <label className="field" key={name}>
              {label}
              <input
                name={name}
                type={type}
                required={name !== 'address'}
                minLength={type === 'password' ? 12 : undefined}
                maxLength={type === 'password' ? 128 : 240}
                autoComplete={type === 'password' ? 'new-password' : undefined}
              />
            </label>
          ))}
          <p>Use a password with at least 12 characters.</p>
          <ErrorMessage error={mutation.error} />
          <button className="button primary full-button" disabled={mutation.isPending}>
            {mutation.isPending ? 'Creating workspace…' : 'Create business'}
          </button>
        </form>
        <Link className="text-link" to="/login">
          Already registered? Sign in
        </Link>
      </section>
    </main>
  );
}
