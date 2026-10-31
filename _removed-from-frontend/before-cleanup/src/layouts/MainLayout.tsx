import {useState} from 'react';
import {Outlet, useNavigate, useLocation} from 'react-router-dom';
import {Layout, Menu, Button, Select, Dropdown, Avatar, theme, Tooltip} from 'antd';
import {
    LayoutDashboard,
    MapPinned,
    Map,
    Users,
    ShieldCheck,
    Moon,
    Sun,
    LogOut,
    User,
    PanelRightClose,
    PanelLeftClose,
    Waypoints,
} from 'lucide-react';
import {useTheme} from '@/hooks/useTheme';
import {useAppSelector, useAppDispatch} from '@/store';
import {logout} from '@/store/slices/authSlice';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';
import {ROUTES} from '@/router/routes';
import {useTranslation} from 'react-i18next';
import {Role} from '@/types/auth.types';
import type {MenuProps} from 'antd';

const {Sider, Header, Content} = Layout;

export function MainLayout() {
    const [collapsed, setCollapsed] = useState(true);
    const navigate = useNavigate();
    const location = useLocation();
    const dispatch = useAppDispatch();
    const {t} = useTranslation();
    const {token: antdToken} = theme.useToken();

    const user = useAppSelector((state) => state.auth.user);
    const {mode, color, toggleMode, changeColor, themeOptions} = useTheme();

    const handleLogout = () => {
        dispatch(logout());
        navigate(ROUTES.LOGIN);
    };

    const menuItems: MenuProps['items'] = [
        {
            key: ROUTES.DASHBOARD,
            icon: <LayoutDashboard size={18}/>,
            label: t('sidebar.dashboard'),
            onClick: () => navigate(ROUTES.DASHBOARD),
        },
        {
            key: ROUTES.MAP,
            icon: <MapPinned size={18}/>,
            label: t('sidebar.map'),
            onClick: () => navigate(ROUTES.MAP),
        },
        {
            key: ROUTES.MAPS,
            icon: <Map size={18}/>,
            label: t('sidebar.maps'),
            onClick: () => navigate(ROUTES.MAPS),
        },
        {
            key: ROUTES.GROUPS,
            icon: <Users size={18}/>,
            label: t('sidebar.groups'),
            onClick: () => navigate(ROUTES.GROUPS),
        },
    ];

    const adminMenuItem: MenuProps['items'] = [
        {
            key: ROUTES.GATEWAY,
            icon: <Waypoints size={18}/>,
            label: t('sidebar.gateway'),
            onClick: () => navigate(ROUTES.GATEWAY),
        },
        {
            key: ROUTES.ADMIN,
            icon: <ShieldCheck size={18}/>,
            label: t('sidebar.admin'),
            onClick: () => navigate(ROUTES.ADMIN),
        },
    ];

    const userMenuItems: MenuProps['items'] = [
        {
            key: 'user-info',
            label: (
                <div className="flex flex-col py-(--c-spacing-xxs)">
                    <span className="font-semibold">{user?.username}</span>
                    <span className="text-(length:--c-font-size-sm) text-subtle">{user?.role}</span>
                </div>
            ),
            disabled: true,
        },
        {type: 'divider'},
        {
            key: 'logout',
            icon: <LogOut size={14}/>,
            label: t('logout'),
            danger: true,
            onClick: handleLogout,
        },
    ];

    const selectedKeys = [location.pathname];

    // The map fills the whole content area, edge to edge.
    const isFullBleed = location.pathname === ROUTES.MAP || location.pathname === ROUTES.MAPS;

    const siderItems = user?.role === Role.ADMIN
        ? [...(menuItems ?? []), ...(adminMenuItem ?? [])]
        : menuItems;

    return (
        <Layout className="h-dvh overflow-hidden bg-transparent!">
            <Sider
                collapsible
                collapsed={collapsed}
                onCollapse={setCollapsed}
                breakpoint="lg"
                trigger={null}
                width={260}
                collapsedWidth={65}
                className="h-dvh shrink-0 bg-container! border-r border-line-soft"
            >
                <div
                    className={`h-16 flex items-center ${collapsed ? 'justify-center' : 'justify-between px-(--c-spacing-sm)'}`}
                >
                    <Tooltip title={collapsed ? 'Open sidebar' : t('appName')} placement="right">
                        <button
                            type="button"
                            aria-label={collapsed ? 'Open sidebar' : t('appName')}
                            onClick={() => collapsed && setCollapsed(false)}
                            className="group size-9 shrink-0 rounded-(--c-border-radius) bg-brand text-(--c-color-on-primary) flex items-center justify-center font-bold shadow-sm"
                        >
                            {collapsed ? (
                                <>
                                    <span className="group-hover:hidden group-focus-visible:hidden">R</span>
                                    <PanelRightClose size={18} className="hidden group-hover:block group-focus-visible:block"/>
                                </>
                            ) : 'R'}
                        </button>
                    </Tooltip>
                    {!collapsed && (
                        <div className="text-lg font-bold mr-auto ml-(--c-spacing-xs) whitespace-nowrap">React Starter</div>
                    )}
                    {!collapsed && (
                        <Tooltip title="Close sidebar">
                            <Button
                                type="text"
                                aria-label="Close sidebar"
                                icon={<PanelLeftClose size={18}/>}
                                onClick={() => setCollapsed(true)}
                            />
                        </Tooltip>
                    )}
                </div>

                <Menu
                    mode="inline"
                    inlineCollapsed={collapsed}
                    selectedKeys={selectedKeys}
                    items={siderItems}
                    className="border-none! bg-transparent! px-(--c-spacing-xs)"
                />
            </Sider>

            <Layout className="h-dvh min-w-0 bg-transparent!">
                <Header
                    className="flex shrink-0 items-center bg-container! justify-between px-(--c-spacing-lg)! border-b border-line-soft"
                    style={{
                        height: 60,
                    }}
                >
                    <div></div>
                    <div className="flex items-center gap-(--c-spacing-xs) sm:gap-(--c-spacing-sm)">
                        <div className="hidden md:block">
                            <LanguageSwitcher/>
                        </div>

                        <Button
                            onClick={toggleMode}
                            variant="filled"
                            icon={mode === 'dark' ? <Sun size={16}/> : <Moon size={16}/>}
                        />

                        <div className="hidden sm:block">
                            <Select
                                value={color}
                                style={{width: 120}}
                                onChange={changeColor}
                                options={themeOptions}
                            />
                        </div>

                        <Dropdown menu={{items: userMenuItems}} trigger={['click']} placement="bottomRight">
                            <Button type="text" className="flex items-center gap-(--c-spacing-xs) h-auto! py-(--c-spacing-xxs)">
                                <Avatar
                                    size={32}
                                    icon={<User size={16}/>}
                                    style={{backgroundColor: antdToken.colorPrimary}}
                                />
                                {user?.username && (
                                    <span className="hidden sm:inline font-medium">{user.username}</span>
                                )}
                            </Button>
                        </Dropdown>
                    </div>
                </Header>

                <Content
                    className="content-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-(--c-color-bg-base)"
                    style={{borderRadius: isFullBleed ? 0 : 'var(--c-border-radius-lg)'}}
                >
                    <div className={isFullBleed ? 'h-full' : 'min-h-full p-(--c-spacing) lg:p-(--c-spacing-lg)'}>
                        <Outlet/>
                    </div>
                </Content>
            </Layout>
        </Layout>
    );
}
