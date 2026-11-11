import ProductImage from '../components/ProductImage';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { Store } from '../components/icons';
import { Notice } from '../components/ui';

const schema = z.object({
  email: z.string().email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export default function Login() {
  const [submitted, setSubmitted] = useState(false);
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
          Phase 1 preview. Sign-in is planned; no account credentials are sent or saved.
        </Notice>
        <form noValidate onSubmit={handleSubmit(() => setSubmitted(true))}>
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
          <button className="button primary full-button">Preview sign-in form</button>
          {submitted && (
            <p role="status">Sign-in is unavailable in Phase 1. No session was created.</p>
          )}
        </form>
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
          Gambian dalasi · Local development · Phase 1
        </p>
      </aside>
    </main>
  );
}
