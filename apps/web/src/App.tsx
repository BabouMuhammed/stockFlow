import { useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ArrowDownToLine,
  ArrowLeftRight,
  BarChart3,
  Boxes,
  ClipboardList,
  CreditCard,
  LayoutDashboard,
  LogOut,
  Settings,
  ShoppingCart,
  Store,
  Tags,
  Truck,
} from './components/icons';
import { request } from './api';
import { Notice } from './components/ui';
import { SessionProvider, useSession } from './features/session';
import Catalogue, { QueryFeedback } from './features/catalogue';
import References from './features/references';
import Pos from './features/pos';
import Login from './pages/Login';
import PreviewApp from './PreviewApp';
import WorkspaceShell from './components/WorkspaceShell';
import Register from './pages/Register';
import Inventory from './features/inventory';
import Sales from './features/sales';
import Reports from './features/reports';
import { BusinessRecords, Employees, SettingsPage } from './features/management';
const navigation = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/products', label: 'Products', icon: Boxes },
  { to: '/categories', label: 'Categories', icon: Tags },
  { to: '/suppliers', label: 'Suppliers', icon: Truck, admin: true },
  { to: '/inventory', label: 'Inventory', icon: ArrowLeftRight },
  { to: '/inventory/receipts', label: 'Stock receipts', icon: ArrowDownToLine },
  { to: '/inventory/counts', label: 'Stock history', icon: ClipboardList },
  { to: '/pos', label: 'Point of sale', icon: ShoppingCart },
  { to: '/sales', label: 'Sales history', icon: CreditCard },
  { to: '/expenses', label: 'Expenses', icon: CreditCard, admin: true },
  { to: '/customers', label: 'Customers', icon: Store },
  { to: '/reports', label: 'Reports', icon: BarChart3 },
  { to: '/staff', label: 'Staff', icon: Store },
  { to: '/settings', label: 'Settings', icon: Settings },
];
export default function App() {
  const location = useLocation();
  if (location.pathname.startsWith('/preview/')) return <PreviewApp basePath="/preview" />;
  return (
    <SessionProvider>
      <Workspace />
    </SessionProvider>
  );
}
function Workspace() {
  const { session, isPending, error, refresh, logout } = useSession();
  const location = useLocation();
  const [logoutError, setLogoutError] = useState(''),
    [loggingOut, setLoggingOut] = useState(false);
  const health = useQuery({
    queryKey: ['readiness'],
    queryFn: () => request<{ status: string }>('/health/ready'),
    retry: false,
    refetchInterval: 30000,
  });
  if (isPending)
    return (
      <main className="login-page">
        <div className="login-card" role="status">
          Checking your session...
        </div>
      </main>
    );
  if (!session) {
    if (error)
      return (
        <main className="login-page">
          <section className="login-card">
            <h1>Connect to your workspace</h1>
            <QueryFeedback pending={false} error={error} retry={refresh} />
            <Link className="text-link" to="/preview/dashboard">
              Explore the labelled demo
            </Link>
          </section>
        </main>
      );
    return location.pathname === '/register' ? (
      <Register />
    ) : location.pathname === '/login' ? (
      <Login />
    ) : (
      <Navigate to="/login" replace />
    );
  }
  if (location.pathname === '/login' || location.pathname === '/register')
    return <Navigate to="/dashboard" replace />;
  const title =
    navigation.find((item) => item.to === location.pathname)?.label ??
    (location.pathname === '/' ? 'Dashboard' : 'Page not found');
  const doLogout = async () => {
    setLoggingOut(true);
    setLogoutError('');
    try {
      await logout();
    } catch (err) {
      setLogoutError(err instanceof Error ? err.message : 'Logout failed; retry');
    } finally {
      setLoggingOut(false);
    }
  };
  return (
    <WorkspaceShell
      title={title}
      business={session.business.name}
      navigation={navigation.filter((item) =>
        session.user.role === 'CASHIER'
          ? ['/dashboard', '/pos', '/sales', '/customers', '/settings'].includes(item.to)
          : item.to !== '/staff' || session.user.role === 'OWNER',
      )}
      status={
        <div className="sidebar-status" role="status">
          <span className={'connection-dot ' + (health.isSuccess ? 'connected' : '')} />
          {health.isPending
            ? 'Checking database...'
            : health.isSuccess
              ? 'Database reachable'
              : 'Database not verified'}
        </div>
      }
      user={
        <div className="user-row">
          <div className="avatar" title={session.user.name}>
            {session.user.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="user-meta">
            <strong>{session.user.name}</strong>
            <span>{session.user.role.toLowerCase()}</span>
          </div>
          <button
            className="icon-button"
            onClick={() => {
              void doLogout();
            }}
            disabled={loggingOut}
            aria-label="Log out"
          >
            <LogOut size={18} />
          </button>
        </div>
      }
    >
      {session.business.isDemo && (
        <Notice>
          Illustrative demonstration business. Catalogue changes are saved to its local database.
        </Notice>
      )}
      {error && <QueryFeedback pending={false} error={error} retry={refresh} />}{' '}
      {logoutError && (
        <p className="form-alert" role="alert">
          {logoutError}
        </p>
      )}
      <Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/products" element={<Catalogue />} />
        <Route path="/categories" element={<References />} />
        <Route path="/suppliers" element={<References suppliers />} />
        <Route path="/pos" element={<Pos />} />
        <Route path="/sales" element={<Sales />} />
        <Route
          path="/expenses"
          element={
            <Admin>
              <BusinessRecords expenses />
            </Admin>
          }
        />
        <Route path="/customers" element={<BusinessRecords />} />
        <Route
          path="/staff"
          element={
            <Admin owner>
              <Employees />
            </Admin>
          }
        />
        <Route path="/employees" element={<Navigate to="/staff" replace />} />
        <Route
          path="/reports"
          element={
            <Admin>
              <Reports />
            </Admin>
          }
        />
        {['/inventory', '/inventory/receipts', '/inventory/counts'].map((path) => (
          <Route
            key={path}
            path={path}
            element={
              <Admin>
                <Inventory />
              </Admin>
            }
          />
        ))}
        <Route path="/settings" element={<SettingsPage />} />
        <Route
          path="*"
          element={
            <section className="panel overview-panel">
              <h2>Page not found</h2>
              <Link className="text-link" to="/dashboard">
                Return to dashboard
              </Link>
            </section>
          }
        />
      </Routes>
    </WorkspaceShell>
  );
}
function Dashboard() {
  return <Reports dashboard />;
}
function Admin({ children, owner = false }: { children: React.ReactNode; owner?: boolean }) {
  const { session } = useSession();
  return session?.user.role === 'CASHIER' || (owner && session?.user.role !== 'OWNER') ? (
    <Notice>Your role does not have access to this page.</Notice>
  ) : (
    children
  );
}
