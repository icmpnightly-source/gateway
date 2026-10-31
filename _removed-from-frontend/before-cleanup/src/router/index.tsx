import {createBrowserRouter, Navigate} from 'react-router-dom';
import {AuthLayout} from '@/layouts/AuthLayout';
import {MainLayout} from '@/layouts/MainLayout';
import {AuthGuard} from '@/router/guards/AuthGuard';
import {RoleGuard} from '@/router/guards/RoleGuard';
import {LoginPage} from '@/modules/auth/pages/LoginPage';
import {DashboardPage} from '@/modules/dashboard/pages/DashboardPage';
import {AdminPage} from '@/modules/dashboard/pages/AdminPage';
import {MapPage} from '@/modules/map/pages/MapPage';
import {GroupsPage} from '@/modules/groups/pages/GroupsPage';
import {MapsPage} from '@/modules/maps/pages/MapsPage';
import {GatewayPage} from '@/modules/gateway/pages/GatewayPage';
import {Role} from '@/types/auth.types';
import {ROUTES} from './routes';
import {ErrorLayout} from '@/layouts/ErrorLayout';
import {AppErrorPage} from '@/components/AppErrorPage';

export const router = createBrowserRouter([
    {
        path: ROUTES.LOGIN,
        element: <AuthLayout/>,
        children: [
            {
                index: true,
                element: <LoginPage/>,
            },
        ],
    },

    {
        element: <AuthGuard/>,
        children: [
            {
                element: <MainLayout/>,
                children: [
                    {
                        path: '/',
                        element: <Navigate to={ROUTES.DASHBOARD} replace/>,
                    },
                    {
                        path: ROUTES.DASHBOARD,
                        element: <DashboardPage/>,
                    },
                    {
                        path: ROUTES.MAP,
                        element: <MapPage/>,
                    },
                    {
                        path: ROUTES.GROUPS,
                        element: <GroupsPage/>,
                    },
                    {
                        path: ROUTES.MAPS,
                        element: <MapsPage/>,
                    },
                    {
                        element: <RoleGuard allowedRoles={[Role.ADMIN]}/>,
                        children: [
                            {
                                path: ROUTES.ADMIN,
                                element: <AdminPage/>,
                            },
                            {
                                path: ROUTES.GATEWAY,
                                element: <GatewayPage/>,
                            },
                        ],
                    },
                ],
            },
        ],
    },

    {
        element: <ErrorLayout/>,
        children: [
            {
                path: ROUTES.FORBIDDEN,
                element: <AppErrorPage code={403}/>
            },
            {
                path: "*",
                element: <AppErrorPage code={404}/>
            },
            {
                path: ROUTES.SERVER_ERROR,
                element: <AppErrorPage code={500}/>
            }
        ]
    }
]);
