// Policy foundation only. Routes never trust caller-supplied identities.
export type Role = 'OWNER' | 'MANAGER' | 'CASHIER';
export type Permission =
  | 'inventory'
  | 'reports'
  | 'staff'
  | 'settings'
  | 'checkout'
  | 'catalogue:read'
  | 'catalogue:write';
export function can(role: Role, permission: Permission): boolean {
  return (
    role === 'OWNER' ||
    permission === 'catalogue:read' ||
    (role === 'MANAGER' && permission === 'catalogue:write') ||
    (role === 'MANAGER' && ['inventory', 'reports', 'checkout'].includes(permission)) ||
    (role === 'CASHIER' && permission === 'checkout')
  );
}
