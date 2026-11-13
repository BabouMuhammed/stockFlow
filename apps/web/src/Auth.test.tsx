import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import Register, { registrationSchema } from './pages/Register';
import Login from './pages/Login';
import PasswordField from './components/PasswordField';
import WorkspaceShell from './components/WorkspaceShell';
import { Store } from './components/icons';
import { SessionProvider, useSession } from './features/session';

const details = {
  businessName: 'Test shop',
  name: 'Test owner',
  email: 'owner@example.test',
  phone: '12345678',
  password: 'my shop is open',
  passwordConfirmation: 'my shop is open',
};
const fetcher = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) =>
  Response.json({ error: 'Sign in to continue' }, { status: 401 }),
);
function setup(page: React.ReactNode) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <SessionProvider>{page}</SessionProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
}
beforeEach(() => {
  fetcher.mockReset();
  fetcher.mockImplementation(async () =>
    Response.json({ error: 'Sign in to continue' }, { status: 401 }),
  );
  vi.stubGlobal('fetch', fetcher);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('passphrase-friendly registration and account controls', () => {
  it('announces successful registration only after the backend confirms it', async () => {
    const created = {
      user: { id: 'owner', name: 'Owner', email: details.email, role: 'OWNER' },
      business: { id: 'business', name: details.businessName, isDemo: false, currency: 'GMD' },
      csrfToken: 'a'.repeat(64),
      expiresAt: new Date(Date.now() + 60000).toISOString(),
      branchAccess: 'MAIN_STORE',
    };
    fetcher.mockImplementation(async (url) =>
      String(url).endsWith('/auth/register')
        ? Response.json(created)
        : Response.json({ error: 'Sign in' }, { status: 401 }),
    );
    function Destination() {
      const { session } = useSession();
      return session?.registrationCompleted ? (
        <p>Backend confirmed business creation</p>
      ) : (
        <Register />
      );
    }
    setup(<Destination />);
    for (const [name, value] of Object.entries(details))
      fireEvent.change(document.querySelector(`input[name="${name}"]`)!, { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Create business' }));
    expect(await screen.findByText('Backend confirmed business creation')).toBeTruthy();
  });
  it.each([
    'abcdefghijkl',
    'my shop is open',
    '  my shop is open  ',
    'a'.repeat(64),
    'a'.repeat(128),
    'é'.repeat(12),
  ])('accepts a supported passphrase without alteration', (password) => {
    expect(
      registrationSchema.parse({ ...details, password, passwordConfirmation: password }).password,
    ).toBe(password);
  });
  it.each(['short', 'a'.repeat(11), 'a'.repeat(129)])(
    'rejects unsupported password lengths',
    (password) => {
      expect(
        registrationSchema.safeParse({ ...details, password, passwordConfirmation: password })
          .success,
      ).toBe(false);
    },
  );
  it('rejects mismatched confirmation at its field', () => {
    const result = registrationSchema.safeParse({
      ...details,
      passwordConfirmation: 'a different phrase',
    });
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0].path).toEqual(['passwordConfirmation']);
  });
  it('toggles visibility without altering the password or submitting a form', () => {
    const submitted = vi.fn();
    render(
      <form onSubmit={submitted}>
        <PasswordField
          label="Password"
          name="password"
          newPassword
          defaultValue="  a useful phrase  "
        />
      </form>,
    );
    const input = screen.getByLabelText('Password') as HTMLInputElement;
    const paste = new Event('paste', { bubbles: true, cancelable: true });
    expect(input.dispatchEvent(paste)).toBe(true);
    expect(input.autocomplete).toBe('new-password');
    fireEvent.click(screen.getByRole('button', { name: 'Show password' }));
    expect(input.type).toBe('text');
    expect(input.value).toBe('  a useful phrase  ');
    expect(screen.getByRole('button', { name: 'Hide password' }).getAttribute('aria-pressed')).toBe(
      'true',
    );
    fireEvent.click(screen.getByRole('button', { name: 'Hide password' }));
    expect(input.type).toBe('password');
    expect(submitted).not.toHaveBeenCalled();
  });
  it('shows inline errors and retains registration input after a backend error', async () => {
    setup(<Register />);
    fireEvent.click(screen.getByRole('button', { name: 'Create business' }));
    expect(await screen.findByText('Enter your business name')).toBeTruthy();
    for (const [name, value] of Object.entries(details)) {
      fireEvent.change(document.querySelector(`input[name="${name}"]`)!, { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Create business' }));
    await waitFor(() =>
      expect(fetcher.mock.calls.some(([url]) => String(url).endsWith('/auth/register'))).toBe(true),
    );
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect((screen.getByLabelText('Business name') as HTMLInputElement).value).toBe(
      details.businessName,
    );
    const call = fetcher.mock.calls.find(([url]) => String(url).endsWith('/auth/register'))!;
    expect(JSON.parse(String(call[1]?.body)).password).toBe(details.password);
    expect(call[1]?.credentials).toBe('include');
  });
  it('provides the registration button without illustrative workspace navigation or photos', () => {
    setup(<Login />);
    expect(
      screen.getByRole('link', { name: 'New business? Register here' }).getAttribute('href'),
    ).toBe('/register');
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeTruthy();
    expect(screen.queryByText(/Explore/)).toBeNull();
    expect(document.querySelector('img')).toBeNull();
    expect(screen.getByText('Illustrative preview')).toBeTruthy();
    expect(screen.getByLabelText('Business ID (optional)')).toBeTruthy();
  });
  it('blocks rapid duplicate submissions while a sign-in request is pending', async () => {
    let release!: () => void;
    const gate = new Promise<void>((done) => {
      release = done;
    });
    fetcher.mockImplementation(async (url) => {
      if (String(url).endsWith('/auth/login')) await gate;
      return Response.json({ error: 'Sign in to continue' }, { status: 401 });
    });
    setup(<Login />);
    fireEvent.change(screen.getByLabelText('Email address'), { target: { value: details.email } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: details.password } });
    const form = screen.getByRole('button', { name: 'Sign In' }).closest('form')!;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() =>
      expect(
        fetcher.mock.calls.filter(([url]) => String(url).endsWith('/auth/login')),
      ).toHaveLength(1),
    );
    expect((screen.getByRole('button', { name: /Signing in/ }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    release();
    await screen.findByRole('alert');
    expect((screen.getByLabelText('Email address') as HTMLInputElement).value).toBe(details.email);
  });
});

describe('mobile navigation keyboard behavior', () => {
  it('contains focus, closes with Escape and restores the menu trigger', () => {
    vi.stubGlobal('innerWidth', 375);
    render(
      <MemoryRouter>
        <WorkspaceShell
          title="Products"
          business="Test shop"
          navigation={[{ to: '/products', label: 'Products', icon: Store }]}
          status={null}
          user={null}
        >
          <button>Page action</button>
        </WorkspaceShell>
      </MemoryRouter>,
    );
    const trigger = screen.getByRole('button', { name: 'Open navigation' });
    trigger.focus();
    fireEvent.click(trigger);
    const drawer = screen.getByRole('dialog', { name: 'Workspace navigation' });
    expect(drawer.getAttribute('aria-modal')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
    expect(document.querySelector<HTMLElement>('.main-column')!.inert).toBe(true);
    const last = screen.getByRole('link', { name: 'Products' });
    last.focus();
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close menu' }));
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.querySelector<HTMLElement>('.main-column')!.inert).not.toBe(true);
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('link', { name: 'Products' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(trigger.getAttribute('aria-expanded')).toBe('false');
  });
});
