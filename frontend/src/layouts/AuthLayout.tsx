import { Navigate, Outlet } from 'react-router-dom';
import { useAppSelector } from '@/store';
import { ROUTES } from '@/router/routes';

export function AuthLayout() {
  const isAuthenticated = useAppSelector((state) => state.auth.isAuthenticated);

  if (isAuthenticated) {
    return <Navigate to={ROUTES.HOME} replace />;
  }

  return (
    <div className="min-h-dvh flex items-center justify-center bg-layout p-4">
      <div className="w-full max-w-md">
        <Outlet />
      </div>
    </div>
  );
};
