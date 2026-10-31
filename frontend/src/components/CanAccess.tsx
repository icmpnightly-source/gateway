import type { ReactNode } from 'react';
import { useAppSelector } from '@/store';
import type { Role } from '@/types/auth.types';

interface CanAccessProps {
  roles: Role[];
  children: ReactNode;
  fallback?: ReactNode;
}

export function CanAccess({ roles, children, fallback = null }: CanAccessProps) {
  const role = useAppSelector((state) => state.auth.role);

  if (!role || !roles.includes(role)) {
    return <>{fallback}</>;
  }

  return <>{children}</>;
}
