import { forwardRef, useId, useState, type InputHTMLAttributes } from 'react';
export const PASSWORD_GUIDANCE = 'Use at least 12 characters. A memorable phrase works well.';
type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
  label: string;
  error?: string;
  newPassword?: boolean;
  hint?: string;
};
const PasswordField = forwardRef<HTMLInputElement, Props>(function PasswordField(
  { label, error, newPassword = false, hint, id, autoComplete, ...props },
  ref,
) {
  const generated = useId();
  const inputId = id ?? generated;
  const [visible, setVisible] = useState(false);
  const guidance = hint ?? (newPassword ? PASSWORD_GUIDANCE : '');
  const descriptions = [
    props['aria-describedby'],
    guidance && inputId + '-hint',
    error && inputId + '-error',
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className="field password-field">
      <label htmlFor={inputId}>{label}</label>
      <div className="password-control">
        <input
          {...props}
          ref={ref}
          id={inputId}
          type={visible ? 'text' : 'password'}
          minLength={newPassword ? 12 : undefined}
          maxLength={128}
          autoComplete={autoComplete ?? (newPassword ? 'new-password' : 'current-password')}
          autoCapitalize="none"
          spellCheck={false}
          aria-invalid={error ? true : props['aria-invalid']}
          aria-describedby={descriptions || undefined}
        />
        <button
          type="button"
          aria-label={`${visible ? 'Hide' : 'Show'} ${label.toLowerCase()}`}
          aria-pressed={visible}
          aria-controls={inputId}
          disabled={props.disabled}
          onClick={() => setVisible(!visible)}
        >
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {guidance && (
        <p className="field-hint" id={inputId + '-hint'}>
          {guidance}
        </p>
      )}
      {error && (
        <p className="field-error" id={inputId + '-error'} role="alert">
          {error}
        </p>
      )}
    </div>
  );
});
export default PasswordField;
