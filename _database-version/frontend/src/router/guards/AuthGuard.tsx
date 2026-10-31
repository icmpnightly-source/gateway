import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '@/store';
import { ROUTES } from '@/router/routes';

export function AuthGuard() {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  if (!isAuthenticated) {
    return <Navigate to={ROUTES.LOGIN} replace />;
  }

  return <Outlet />;
}
