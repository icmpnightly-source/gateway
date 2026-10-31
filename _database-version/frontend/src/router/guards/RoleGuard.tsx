import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '@/store';
import { ROUTES } from '@/router/routes';
import type { Role } from '@/types/auth.types';

interface RoleGuardProps {
  allowedRoles: Role[];
}

export function RoleGuard({ allowedRoles }: RoleGuardProps) {
  const role = useAppSelector((state) => state.auth.role);

  if (!role || !allowedRoles.includes(role)) {
    return <Navigate to={ROUTES.FORBIDDEN} replace />;
  }

  return <Outlet />;
}
