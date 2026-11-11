import ProductImage from '../components/ProductImage';
import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Store } from '../components/icons';
import { Notice } from '../components/ui';
import { useSession } from '../features/session';

const schema = z.object({
  businessId: z.union([z.literal(''), z.string().uuid('Enter a valid business ID')]).optional(),
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export default function Login() {
  const { login } = useSession();
  const mutation = useMutation({ mutationFn: login });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <main className="login-page">
      <section className="login-card">
        <div className="brand">
          <div className="brand-mark">
            <Store />
          </div>
          <strong>StockFlow</strong>
        </div>
        <p className="eyebrow">YOUR RETAIL WORKSPACE</p>
        <h1>Welcome back.</h1>
        <p>One place for your products, stock and daily operations.</p>
        <Notice>
          Sign in with your email and password. Existing accounts sharing an email also need their
          business ID.
        </Notice>
        <form
          noValidate
          onSubmit={handleSubmit((values) =>
            mutation.mutate({ ...values, businessId: values.businessId || undefined }),
          )}
        >
          <label className="field">
            Business ID (optional)
            <input
              {...register('businessId')}
              autoComplete="organization"
              aria-invalid={!!errors.businessId}
              aria-describedby={errors.businessId ? 'business-error' : undefined}
            />
          </label>
          {errors.businessId && (
            <p id="business-error" className="field-error" role="alert">
              {errors.businessId.message}
            </p>
          )}
          <label className="field">
            Email address
            <input
              autoComplete="username"
              type="email"
              {...register('email')}
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? 'email-error' : undefined}
            />
          </label>
          {errors.email && (
            <p id="email-error" className="field-error" role="alert">
              {errors.email.message}
            </p>
          )}
          <label className="field">
            Password
            <input
              autoComplete="current-password"
              type="password"
              {...register('password')}
              aria-invalid={!!errors.password}
              aria-describedby={errors.password ? 'password-error' : undefined}
            />
          </label>
          {errors.password && (
            <p id="password-error" className="field-error" role="alert">
              {errors.password.message}
            </p>
          )}
          <button className="button primary full-button" disabled={mutation.isPending}>
            {mutation.isPending ? 'Signing in...' : 'Sign in'}
          </button>
          {mutation.error && (
            <p className="form-alert" role="alert">
              {mutation.error.message}
            </p>
          )}
        </form>
        <Link className="text-link" to="/register">
          Register your business
        </Link>
        <Link className="text-link" to="/preview/dashboard">
          Explore the illustrative workspace →
        </Link>
      </section>
      <aside className="login-art">
        <Store size={90} strokeWidth={1} />
        <h2>
          A clearer view of
          <br />
          your everyday business.
        </h2>
        <div className="login-product-strip" aria-hidden="true">
          {['Rice 25kg', 'Milk 1L', 'Cooking Oil 1L'].map((name) => (
            <div key={name}>
              <ProductImage name={name} />
            </div>
          ))}
        </div>
        <p className="login-photo-note">
          Representative product photos. <a href="/images/products/credits.html">Photo credits</a>
        </p>
        <p>
          Built for retail in The Gambia.
          <br />
          Gambian dalasi · Local development
        </p>
      </aside>
    </main>
  );
}
