import { useMutation } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import AuthLayout from '../components/AuthLayout';
import PasswordField, { PASSWORD_GUIDANCE } from '../components/PasswordField';
import { useSession } from '../features/session';
import { ErrorMessage, useSubmitGuard } from '../features/workflows';
const password = z.string().min(12, PASSWORD_GUIDANCE).max(128, 'Use no more than 128 characters');
export const registrationSchema = z
  .object({
    businessName: z.string().trim().min(1, 'Enter your business name').max(120),
    name: z.string().trim().min(1, 'Enter your full name').max(120),
    email: z.email('Enter a valid email address').max(254),
    phone: z.string().trim().min(3, 'Enter a phone number').max(40),
    address: z.string().trim().max(240).optional(),
    password,
    passwordConfirmation: password,
  })
  .refine((value) => value.password === value.passwordConfirmation, {
    message: 'Passwords do not match',
    path: ['passwordConfirmation'],
  });
export default function Register() {
  const { registerBusiness } = useSession();
  const submit = useSubmitGuard();
  const mutation = useMutation({ mutationFn: registerBusiness });
  const {
    register,
    handleSubmit,
    formState: { errors },
  } = useForm<z.infer<typeof registrationSchema>>({ resolver: zodResolver(registrationSchema) });
  const fields = [
    ['businessName', 'Business name', 'text', 'organization'],
    ['name', 'Owner’s full name', 'text', 'name'],
    ['email', 'Email address', 'email', 'username'],
    ['phone', 'Phone number', 'tel', 'tel'],
    ['address', 'Business address (optional)', 'text', 'street-address'],
  ] as const;
  return (
    <AuthLayout>
      <h1>Register your business</h1>
      <p>Start with an empty workspace for your shop. Prices and receipts use Gambian dalasi.</p>
      <form
        noValidate
        aria-busy={mutation.isPending}
        onSubmit={handleSubmit((values) =>
          submit(() => mutation.mutateAsync({ ...values, address: values.address ?? '' })),
        )}
      >
        <div className="auth-form-grid">
          {fields.map(([name, label, type, autoComplete]) => (
            <div className={'field' + (name === 'businessName' ? ' full-field' : '')} key={name}>
              <label htmlFor={'register-' + name}>{label}</label>
              <input
                id={'register-' + name}
                {...register(name)}
                type={type}
                autoComplete={autoComplete}
                required={name !== 'address'}
                maxLength={
                  name === 'email' ? 254 : name === 'phone' ? 40 : name === 'address' ? 240 : 120
                }
                aria-invalid={!!errors[name]}
                aria-describedby={errors[name] ? name + '-error' : undefined}
              />
              {errors[name] && (
                <span id={name + '-error'} className="field-error" role="alert">
                  {errors[name]?.message}
                </span>
              )}
            </div>
          ))}
        </div>
        <PasswordField
          label="Password"
          {...register('password')}
          newPassword
          required
          error={errors.password?.message}
        />
        <PasswordField
          label="Confirm password"
          {...register('passwordConfirmation')}
          newPassword
          hint=""
          required
          error={errors.passwordConfirmation?.message}
        />
        <ErrorMessage error={mutation.error} />
        <button className="button primary full-button" disabled={mutation.isPending}>
          {mutation.isPending ? 'Creating workspace…' : 'Create business'}
        </button>
      </form>
      <Link className="button auth-secondary full-button" to="/login">
        Already registered? Sign in
      </Link>
    </AuthLayout>
  );
}
