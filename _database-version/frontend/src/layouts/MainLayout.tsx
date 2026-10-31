import {useEffect, useState} from 'react';
import {Outlet, useNavigate, useLocation, useSearchParams} from 'react-router-dom';
import {Alert, Layout, Menu, Button, Select, Dropdown, Avatar, theme, Tooltip, message} from 'antd';
import {
    Folder,
    FolderPlus,
    KeyRound,
    LayoutGrid,
    List,
    LogIn,
    Moon,
    Plus,
    Sun,
    LogOut,
    User,
    PanelRightClose,
    PanelLeftClose,
    ScrollText,
    Settings,
    Waypoints,
} from 'lucide-react';
import {useTheme} from '@/hooks/useTheme';
import {useAppSelector, useAppDispatch} from '@/store';
import {logout} from '@/store/slices/authSlice';
import {loadRules} from '@/store/slices/gatewaySlice';
import {addProject, loadProjects} from '@/store/slices/projectsSlice';
import {loadSecrets} from '@/store/slices/secretsSlice';
import {loadStatus} from '@/store/slices/systemSlice';
import {LanguageSwitcher} from '@/components/LanguageSwitcher';
import {ProjectFormModal} from '@/modules/gateway/components/ProjectFormModal';
import {ROUTES, WORK_PARAM, projectPath, workPath} from '@/router/routes';
import {useTranslation} from 'react-i18next';
import type {MenuProps} from 'antd';

const {Sider, Header, Content} = Layout;

// How often this computer's status is asked for.
const STATUS_EVERY_MS = 4000;

/** What the pages inside the layout can ask of it. */
export interface MainLayoutContext {
    openCreateProject: () => void;
}

export function MainLayout() {
    const [collapsed, setCollapsed] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const dispatch = useAppDispatch();
    const {t} = useTranslation();
    const {token: antdToken} = theme.useToken();
    const [messageApi, contextHolder] = message.useMessage();

    // Only an administrator ever signs in; everyone else just uses the app.
    const user = useAppSelector((state) => state.auth.user);
    const projects = useAppSelector((state) => state.projects.items);
    const rules = useAppSelector((state) => state.gateway.items);
    const {mode, color, toggleMode, changeColor, themeOptions} = useTheme();

    const [isCreatingProject, setIsCreatingProject] = useState(false);
    const [isSavingProject, setIsSavingProject] = useState(false);

    const status = useAppSelector((state) => state.system.status);
    const isConnected = status?.database.connected ?? false;
    const revision = status?.revision;
    const isSetUp = status?.configured;
    const onSettings = location.pathname === ROUTES.SETTINGS;

    // How this computer's connection and gateway are doing, asked every few
    // seconds: it is also how changes made on other computers are noticed.
    useEffect(() => {
        void dispatch(loadStatus());
        const timer = setInterval(() => void dispatch(loadStatus()), STATUS_EVERY_MS);
        return () => clearInterval(timer);
    }, [dispatch]);

    // Everything the sidebar and the pages show comes from the shared
    // database: read when it is first reached, and again whenever anyone,
    // here or on another computer, has changed something.
    useEffect(() => {
        if (!isConnected) return;
        void dispatch(loadProjects());
        void dispatch(loadRules());
        void dispatch(loadSecrets());
    }, [dispatch, isConnected, revision]);

    // A fresh install has nothing to show until it is told where the database is.
    useEffect(() => {
        if (isSetUp === false && !onSettings) navigate(ROUTES.SETTINGS, {replace: true});
    }, [isSetUp, onSettings, navigate]);

    const handleCreateProject = async (name: string) => {
        setIsSavingProject(true);
        try {
            const project = await dispatch(addProject(name)).unwrap();
            setIsCreatingProject(false);
            navigate(projectPath(project.id));
        } catch (reason) {
            messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
        } finally {
            setIsSavingProject(false);
        }
    };

    // A project opens into its works, by name.
    const projectItems: MenuProps['items'] = projects.map((project) => ({
        key: `project:${project.id}`,
        icon: <Folder size={18}/>,
        label: project.name,
        children: [
            {
                key: projectPath(project.id),
                icon: <List size={16}/>,
                label: t('sidebar.allWorks'),
                onClick: () => navigate(projectPath(project.id)),
            },
            ...rules
                .filter((rule) => rule.projectId === project.id)
                .map((rule) => ({
                    key: workPath(project.id, rule.id),
                    icon: <Waypoints size={16}/>,
                    label: rule.name,
                    onClick: () => navigate(workPath(project.id, rule.id)),
                })),
            {
                key: workPath(project.id, 'new'),
                icon: <Plus size={16}/>,
                label: t('sidebar.newWork'),
                onClick: () => navigate(workPath(project.id, 'new')),
            },
        ],
    }));

    const menuItems: MenuProps['items'] = [
        {
            key: 'create-project',
            icon: <FolderPlus size={18}/>,
            label: t('sidebar.createProject'),
            onClick: () => setIsCreatingProject(true),
        },
        {
            key: ROUTES.HOME,
            icon: <LayoutGrid size={18}/>,
            label: t('sidebar.projects'),
            onClick: () => navigate(ROUTES.HOME),
        },
        ...projectItems,
        {type: 'divider'},
        {
            key: ROUTES.SECRETS,
            icon: <KeyRound size={18}/>,
            label: t('sidebar.secrets'),
            onClick: () => navigate(ROUTES.SECRETS),
        },
        {
            key: ROUTES.REQUESTS,
            icon: <ScrollText size={18}/>,
            label: t('sidebar.requests'),
            onClick: () => navigate(ROUTES.REQUESTS),
        },
        {
            key: ROUTES.SETTINGS,
            icon: <Settings size={18}/>,
            label: t('sidebar.settings'),
            onClick: () => navigate(ROUTES.SETTINGS),
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
            onClick: () => dispatch(logout()),
        },
    ];

    // A work open for editing is a page address with a query on it.
    const work = searchParams.get(WORK_PARAM);
    const selectedKeys = [work ? `${location.pathname}?${WORK_PARAM}=${work}` : location.pathname];
    const openProject = location.pathname.startsWith('/projects/')
        ? `project:${location.pathname.split('/')[2]}`
        : undefined;

    return (
        <Layout className="h-dvh overflow-hidden bg-transparent!">
            {contextHolder}

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
                                    <span className="group-hover:hidden group-focus-visible:hidden">K</span>
                                    <PanelRightClose size={18} className="hidden group-hover:block group-focus-visible:block"/>
                                </>
                            ) : 'K'}
                        </button>
                    </Tooltip>
                    {!collapsed && (
                        <div className="text-lg font-bold mr-auto ml-(--c-spacing-xs) whitespace-nowrap">{t('appName')}</div>
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
                    // Remounted per project, so the one being looked at starts open.
                    key={openProject}
                    mode="inline"
                    inlineCollapsed={collapsed}
                    selectedKeys={selectedKeys}
                    defaultOpenKeys={openProject ? [openProject] : undefined}
                    items={menuItems}
                    className="content-scrollbar max-h-[calc(100dvh-4rem)] overflow-y-auto border-none! bg-transparent! px-(--c-spacing-xs)"
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

                        {user ? (
                            <Dropdown menu={{items: userMenuItems}} trigger={['click']} placement="bottomRight">
                                <Button type="text" className="flex items-center gap-(--c-spacing-xs) h-auto! py-(--c-spacing-xxs)">
                                    <Avatar
                                        size={32}
                                        icon={<User size={16}/>}
                                        style={{backgroundColor: antdToken.colorPrimary}}
                                    />
                                    <span className="hidden sm:inline font-medium">{user.username}</span>
                                </Button>
                            </Dropdown>
                        ) : (
                            <Button icon={<LogIn size={16}/>} onClick={() => navigate(ROUTES.LOGIN)}>
                                {t('login.adminSignIn')}
                            </Button>
                        )}
                    </div>
                </Header>

                <Content
                    className="content-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain bg-(--c-color-bg-base)"
                    style={{borderRadius: 'var(--c-border-radius-lg)'}}
                >
                    <div className="min-h-full p-(--c-spacing) lg:p-(--c-spacing-lg)">
                        {status && !onSettings && (
                            <div className="flex flex-col gap-(--c-spacing-xs) empty:hidden mb-(--c-spacing)">
                                {status.configured && !status.database.connected && (
                                    <Alert
                                        type="error"
                                        showIcon
                                        title={t('system.bannerNoDb')}
                                        description={status.database.error && t(`system.errors.${status.database.error.reason}`, {
                                            defaultValue: status.database.error.message,
                                        })}
                                        action={<Button onClick={() => navigate(ROUTES.SETTINGS)}>{t('system.openSettings')}</Button>}
                                    />
                                )}
                                {!status.gateway.running && (
                                    <Alert
                                        type="warning"
                                        showIcon
                                        title={t('system.bannerGateway', {port: status.gateway.port})}
                                        action={<Button onClick={() => navigate(ROUTES.SETTINGS)}>{t('system.openSettings')}</Button>}
                                    />
                                )}
                            </div>
                        )}
                        <Outlet context={{openCreateProject: () => setIsCreatingProject(true)} satisfies MainLayoutContext}/>
                    </div>
                </Content>
            </Layout>

            <ProjectFormModal
                open={isCreatingProject}
                projects={projects}
                saving={isSavingProject}
                onSubmit={handleCreateProject}
                onCancel={() => setIsCreatingProject(false)}
            />
        </Layout>
    );
}
