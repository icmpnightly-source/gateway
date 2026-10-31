import {createBrowserRouter} from 'react-router-dom';
import {AuthLayout} from '@/layouts/AuthLayout';
import {MainLayout} from '@/layouts/MainLayout';
import {LoginPage} from '@/modules/auth/pages/LoginPage';
import {ProjectPage} from '@/modules/gateway/pages/ProjectPage';
import {ProjectsPage} from '@/modules/gateway/pages/ProjectsPage';
import {RequestsPage} from '@/modules/gateway/pages/RequestsPage';
import {SecretsPage} from '@/modules/gateway/pages/SecretsPage';
import {SettingsPage} from '@/modules/system/pages/SettingsPage';
import {ROUTES} from './routes';
import {ErrorLayout} from '@/layouts/ErrorLayout';
import {AppErrorPage} from '@/components/AppErrorPage';

export const router = createBrowserRouter([
    // Signing in is for administrators only; everything else is open to all.
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
        element: <MainLayout/>,
        children: [
            {
                path: ROUTES.HOME,
                element: <ProjectsPage/>,
            },
            {
                path: ROUTES.PROJECT,
                element: <ProjectPage/>,
            },
            {
                path: ROUTES.SECRETS,
                element: <SecretsPage/>,
            },
            {
                path: ROUTES.REQUESTS,
                element: <RequestsPage/>,
            },
            {
                path: ROUTES.SETTINGS,
                element: <SettingsPage/>,
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
