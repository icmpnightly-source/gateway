import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '@/store';
import { ROUTES } from '@/router/routes';
import type { Role } from '@/types/auth.types';

interface RoleGuardProps {
  allowedRoles: Role[];
  /** Where everyone else is sent; the "no access" page unless said otherwise. */
  redirectTo?: string;
}

/** Lets the pages inside it be opened only by the roles named. */
export function RoleGuard({ allowedRoles, redirectTo = ROUTES.FORBIDDEN }: RoleGuardProps) {
  const role = useAppSelector((state) => state.auth.role);

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={redirectTo} replace />;
  }

  return <Outlet />;
}
