import { Outlet } from 'react-router-dom';

export function ErrorLayout() {
    return (
        <div className="min-h-dvh flex">
            <Outlet />
        </div>
    )
}
