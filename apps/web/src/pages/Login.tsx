import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AuthLayout from '../components/AuthLayout';
import PasswordField from '../components/PasswordField';
import { ErrorMessage, useSubmitGuard } from '../features/workflows';
import { useSession } from '../features/session';
const schema = z.object({
  businessId: z.union([z.literal(''), z.uuid('Enter a valid business ID')]).optional(),
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password').max(128, 'Use no more than 128 characters'),
});
export default function Login() {
  const { login } = useSession();
  const submit = useSubmitGuard();
  const mutation = useMutation({ mutationFn: login });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout>
      <h1>Welcome back.</h1>
      <p>One place for your products, stock and daily operations.</p>
      <form
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={handleSubmit((values) =>
          submit(() =>
            mutation.mutateAsync({ ...values, businessId: values.businessId || undefined }),
          ),
        )}
      >
        <div className="field">
          <label htmlFor="login-email">Email address</label>
          <input
            id="login-email"
            {...register('email')}
            type="email"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            aria-invalid={!!errors.email}
            aria-describedby={errors.email ? 'login-email-error' : undefined}
          />
          {errors.email && (
            <span id="login-email-error" className="field-error" role="alert">
              {errors.email.message}
            </span>
          )}
        </div>
        <PasswordField
          label="Password"
          {...register('password')}
          required
          error={errors.password?.message}
        />
        <div className="field">
          <label htmlFor="login-business">Business ID (optional)</label>
          <input
            id="login-business"
            {...register('businessId')}
            autoComplete="off"
            aria-invalid={!!errors.businessId}
            aria-describedby={'business-id-help' + (errors.businessId ? ' business-id-error' : '')}
          />
          <span className="field-hint" id="business-id-help">
            Only needed if your email belongs to more than one business. Use the ID provided by your
            business owner.
          </span>
          {errors.businessId && (
            <span id="business-id-error" className="field-error" role="alert">
              {errors.businessId.message}
            </span>
          )}
        </div>
        <ErrorMessage error={mutation.error} />
        <button className="button primary full-button" disabled={mutation.isPending}>
          {mutation.isPending ? 'Signing in…' : 'Sign In'}
        </button>
      </form>
      <Link className="button auth-secondary full-button" to="/register">
        New business? Register here
      </Link>
    </AuthLayout>
  );
}
