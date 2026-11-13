import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AuthLayout from '../components/AuthLayout';
import PasswordField from '../components/PasswordField';
import { Notice } from '../components/ui';
const schema = z.object({
  email: z.email('Enter a valid email address'),
  password: z.string().min(1, 'Enter your password'),
});
export default function PreviewLogin() {
  const [submitted, setSubmitted] = useState(false);
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema) });
  return (
    <AuthLayout>
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
            aria-describedby={errors.email ? 'preview-email-error' : undefined}
          />
        </label>
        {errors.email && (
          <p id="preview-email-error" className="field-error" role="alert">
            {errors.email.message}
          </p>
        )}
        <PasswordField
          label="Password"
          {...register('password')}
          error={errors.password?.message}
        />
        <button className="button primary full-button">Preview sign-in form</button>
        {submitted && (
          <p role="status">Sign-in is unavailable in Phase 1. No session was created.</p>
        )}
      </form>
    </AuthLayout>
  );
}
