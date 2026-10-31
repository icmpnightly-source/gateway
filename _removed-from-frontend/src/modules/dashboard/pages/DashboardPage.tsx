import { Avatar, Button, Card, Checkbox, Input, Progress, Select, Tag, Typography } from 'antd';
import {
    Bell,
    ChevronRight,
    Coffee,
    Filter,
    Folder,
    LockKeyhole,
    MoreHorizontal,
    Plus,
    Search,
    ShieldCheck,
    ShoppingCart,
    Truck,
    UserPlus,
    Users,
    Wallet,
    Zap,
    X,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

const { Text, Title } = Typography;

function Surface({ children, className = '', padded = true }: { children: React.ReactNode; className?: string; padded?: boolean }) {
    return (
        <Card className={`border-line-soft! bg-container! shadow-(--c-box-shadow-card)! ${className}`} styles={{ body: { padding: padded ? 20 : 0 } }}>
            {children}
        </Card>
    );
}

function SectionTitle({ title, description, action }: { title: string; description?: string; action?: React.ReactNode }) {
    return (
        <div className="flex items-start justify-between gap-(--c-spacing)">
            <div>
                <h2 className="text-base font-semibold tracking-tight">{title}</h2>
                {description && <Text type="secondary" className="mt-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">{description}</Text>}
            </div>
            {action}
        </div>
    );
}

export function DashboardPage() {
    const { t } = useTranslation();

    const queue = [
        { initials: 'AS', name: 'Aziza S.', task: t('dashboard.queue.review'), tone: 'processing' },
        { initials: 'KM', name: 'Kamron M.', task: t('dashboard.queue.copy'), tone: 'warning' },
        { initials: 'DS', name: 'Dilshod S.', task: t('dashboard.queue.ready'), tone: 'success' },
    ];
    const goals = [
        { key: 'product', value: '34 000 000 UZS', current: '28 560 000 UZS', percent: 72 },
        { key: 'reserve', value: '25 000 000 UZS', current: '10 200 000 UZS', percent: 46 },
    ];
    const transactions = [
        { Icon: Coffee, key: 'coffee', category: 'service', date: 'today', amount: '-65 000 UZS' },
        { Icon: ShoppingCart, key: 'market', category: 'supplies', date: 'yesterday', amount: '-1 423 000 UZS' },
        { Icon: Wallet, key: 'payout', category: 'income', date: 'oct12', amount: '+42 000 000 UZS', positive: true },
        { Icon: Truck, key: 'delivery', category: 'logistics', date: 'oct11', amount: '-241 000 UZS' },
    ];
    const usageBars = [38, 66, 74, 58, 82, 69, 92, 77];

    return (
        <div className="mx-auto w-full max-w-[1580px] space-y-(--c-spacing-md)">
            <div className="flex flex-col gap-(--c-spacing-sm) sm:flex-row sm:items-end sm:justify-between">
                <div>
                    <Text className="text-(length:--c-font-size-sm)! font-semibold uppercase tracking-[0.18em] text-brand!">{t('dashboard.eyebrow')}</Text>
                    <Title level={2} className="mt-(--c-spacing-xxs)! mb-1! text-2xl! tracking-tight sm:text-3xl!">{t('dashboard.title')}</Title>
                    <Text type="secondary">{t('dashboard.subtitle')}</Text>
                </div>
                <Button type="primary" icon={<Plus size={16} />}>{t('dashboard.newBlock')}</Button>
            </div>

            <div className="grid grid-cols-1 gap-(--c-spacing) xl:grid-cols-12">
                <Surface className="xl:col-span-4" padded={false}>
                    <div className="p-(--c-spacing-md)">
                        <SectionTitle title={t('dashboard.goals.title')} description={t('dashboard.goals.description')} action={<Button size="small" icon={<Plus size={14} />}>{t('dashboard.goals.new')}</Button>} />
                    </div>
                    <div className="space-y-(--c-spacing-sm) px-(--c-spacing-md) pb-(--c-spacing-md)">
                        {goals.map((goal) => (
                            <div key={goal.key} className="rounded-(--c-border-radius-xl) bg-layout p-(--c-spacing)">
                                <Text className="text-(length:--c-font-size-sm)! font-semibold uppercase tracking-[0.12em] text-subtle">{t(`dashboard.goals.${goal.key}`)}</Text>
                                <div className="mt-(--c-spacing-sm) flex items-end justify-between gap-(--c-spacing-sm)">
                                    <p className="text-2xl font-semibold tracking-tight font-(family-name:--c-font-family-mono)">{goal.value}</p>
                                    <Text type="secondary" className="text-(length:--c-font-size-sm)! font-(family-name:--c-font-family-mono)">{goal.current}</Text>
                                </div>
                                <Progress className="mt-(--c-spacing-xs)!" percent={goal.percent} showInfo={false} strokeColor="var(--c-color-primary)" />
                                <Text type="secondary" className="text-(length:--c-font-size-sm)!">{goal.percent}% {t('dashboard.goals.completed')}</Text>
                            </div>
                        ))}
                    </div>
                </Surface>

                <Surface className="xl:col-span-4" padded={false}>
                    <div className="p-(--c-spacing-md)">
                        <SectionTitle title={t('dashboard.security.title')} description={t('dashboard.security.description')} action={<ShieldCheck size={19} className="text-brand" />} />
                        <div className="mt-(--c-spacing-md) space-y-(--c-spacing-sm)">
                            <label className="block space-y-(--c-spacing-xs) text-(length:--c-font-size) font-medium"><span>{t('dashboard.security.email')}</span><Input defaultValue="admin@kompaniya.uz" /></label>
                            <label className="block space-y-(--c-spacing-xs) text-(length:--c-font-size) font-medium"><span>{t('dashboard.security.password')}</span><Input.Password defaultValue="parol123" /></label>
                        </div>
                        <Button type="primary" block className="mt-(--c-spacing-md)" icon={<LockKeyhole size={15} />}>{t('dashboard.security.update')}</Button>
                    </div>
                    <button type="button" className="flex w-full items-center gap-(--c-spacing-sm) border-t border-line-soft bg-layout/50 px-(--c-spacing-md) py-(--c-spacing) text-left transition-colors hover:bg-layout">
                        <span className="flex size-8 items-center justify-center rounded-(--c-border-radius) bg-error/10 text-error"><ShieldCheck size={16} /></span>
                        <span className="min-w-0 flex-1"><span className="block text-(length:--c-font-size) font-medium">{t('dashboard.security.sessions')}</span><span className="block truncate text-(length:--c-font-size-sm) text-subtle">{t('dashboard.security.sessionsDescription')}</span></span>
                        <ChevronRight size={16} className="text-subtle" />
                    </button>
                </Surface>

                <Surface className="xl:col-span-4">
                    <SectionTitle title={t('dashboard.shortcuts.title')} description={t('dashboard.shortcuts.description')} />
                    <div className="mt-(--c-spacing-md) grid grid-cols-2 gap-(--c-spacing-sm)">
                        {[
                            { Icon: Users, key: 'members' },
                            { Icon: Folder, key: 'projects' },
                            { Icon: Bell, key: 'alerts' },
                            { Icon: ShieldCheck, key: 'security' },
                        ].map(({ Icon, key }) => (
                            <button key={key} type="button" className="group rounded-(--c-border-radius-xl) border border-line-soft p-(--c-spacing-sm) text-left transition-colors hover:bg-layout">
                                <Icon size={18} className="text-brand" />
                                <span className="mt-(--c-spacing-md) block text-(length:--c-font-size) font-medium">{t(`dashboard.shortcuts.${key}`)}</span>
                                <ChevronRight size={15} className="mt-(--c-spacing-xs) text-subtle transition-transform group-hover:translate-x-0.5" />
                            </button>
                        ))}
                    </div>
                </Surface>

                <Surface className="xl:col-span-8" padded={false}>
                    <div className="p-(--c-spacing-md)">
                        <SectionTitle title={t('dashboard.transactions.title')} description={t('dashboard.transactions.description')} action={<Button size="small">{t('dashboard.transactions.viewAll')}</Button>} />
                    </div>
                    <div className="border-t border-line-soft px-(--c-spacing-md)">
                        {transactions.map(({ Icon, key, category, date, amount, positive }) => (
                            <div key={key} className="grid grid-cols-[auto_1fr_auto] items-center gap-(--c-spacing-sm) border-b border-line-soft py-(--c-spacing-sm) last:border-b-0 sm:grid-cols-[auto_minmax(0,1fr)_160px_auto_auto]">
                                <span className="flex size-9 items-center justify-center rounded-(--c-border-radius) bg-layout text-muted"><Icon size={17} /></span>
                                <div className="min-w-0"><p className="truncate text-(length:--c-font-size) font-medium">{t(`dashboard.transactions.${key}`)}</p><Text type="secondary" className="text-(length:--c-font-size-sm)!">{t(`dashboard.transactions.${category}`)}</Text></div>
                                <Text type="secondary" className="hidden text-(length:--c-font-size-sm)! sm:block">{t(`dashboard.transactions.${date}`)}</Text>
                                <span className={`text-(length:--c-font-size) font-semibold font-(family-name:--c-font-family-mono) ${positive ? 'text-success' : ''}`}>{amount}</span>
                                <Button type="text" shape="circle" icon={<MoreHorizontal size={16} />} aria-label={t('dashboard.transactions.more')} />
                            </div>
                        ))}
                    </div>
                </Surface>

                <Surface className="xl:col-span-4" padded={false}>
                    <div className="p-(--c-spacing-md)">
                        <SectionTitle title={t('dashboard.usage.title')} description={t('dashboard.usage.description')} action={<Zap size={18} className="text-brand" />} />
                        <div className="mt-(--c-spacing-lg) flex h-32 items-end gap-(--c-spacing-xs)">
                            {usageBars.map((height, index) => <div key={index} className="flex-1 rounded-t-md bg-brand" style={{ height: `${height}%`, opacity: 0.48 + index * 0.06 }} />)}
                        </div>
                        <div className="mt-(--c-spacing-xs) flex justify-between text-[11px] text-subtle">
                            {['6', '8', '10', '12', '14', '16', '18', '20'].map((hour) => <span key={hour}>{hour}</span>)}
                        </div>
                    </div>
                    <div className="grid grid-cols-2 border-t border-line-soft">
                        <div className="border-r border-line-soft p-(--c-spacing)"><Text type="secondary" className="text-(length:--c-font-size-sm)!">{t('dashboard.usage.current')}</Text><p className="mt-(--c-spacing-xxs) text-lg font-semibold">3.4 kVt</p></div>
                        <div className="p-(--c-spacing)"><Text type="secondary" className="text-(length:--c-font-size-sm)!">{t('dashboard.usage.saved')}</Text><p className="mt-(--c-spacing-xxs) text-lg font-semibold text-success">+1.2 kVt</p></div>
                    </div>
                </Surface>

                <Surface className="xl:col-span-4">
                    <SectionTitle title={t('dashboard.filters.title')} description={t('dashboard.filters.description')} action={<Button type="text" size="small" icon={<X size={15} />}>{t('dashboard.filters.clear')}</Button>} />
                    <div className="mt-(--c-spacing-md) space-y-(--c-spacing-sm)">
                        <Input prefix={<Search size={16} className="text-subtle" />} placeholder={t('dashboard.filters.search')} />
                        <div className="grid grid-cols-2 gap-(--c-spacing-sm)">
                            <Select defaultValue="all" options={[{ value: 'all', label: t('dashboard.filters.all') }, { value: 'mine', label: t('dashboard.filters.mine') }]} />
                            <Select defaultValue="open" options={[{ value: 'open', label: t('dashboard.filters.open') }, { value: 'closed', label: t('dashboard.filters.closed') }]} />
                        </div>
                    </div>
                    <div className="mt-(--c-spacing-md) flex items-center justify-between border-t border-line-soft pt-(--c-spacing)">
                        <Text type="secondary" className="text-(length:--c-font-size-sm)!">{t('dashboard.filters.result')}</Text>
                        <Button type="primary" size="small" icon={<Filter size={14} />}>{t('dashboard.filters.apply')}</Button>
                    </div>
                </Surface>

                <Surface className="xl:col-span-4">
                    <SectionTitle title={t('dashboard.invite.title')} description={t('dashboard.invite.description')} action={<UserPlus size={19} className="text-brand" />} />
                    <div className="mt-(--c-spacing-md) space-y-(--c-spacing-sm)!">
                        <Input placeholder={t('dashboard.invite.email')} />
                        <Select className="w-full" defaultValue="editor" options={[{ value: 'editor', label: t('dashboard.invite.editor') }, { value: 'viewer', label: t('dashboard.invite.viewer') }]} />
                        <Checkbox defaultChecked>{t('dashboard.invite.message')}</Checkbox>
                    </div>
                    <Button type="primary" block className="mt-(--c-spacing-md)">{t('dashboard.invite.send')}</Button>
                </Surface>

                <Surface className="xl:col-span-4" padded={false}>
                    <div className="p-(--c-spacing-md)">
                        <SectionTitle title={t('dashboard.queue.title')} description={t('dashboard.queue.description')} action={<Button type="text" shape="circle" icon={<MoreHorizontal size={18} />} aria-label={t('dashboard.queue.more')} />} />
                    </div>
                    <div className="border-t border-line-soft">
                        {queue.map((item) => (
                            <div key={item.initials} className="flex items-center gap-(--c-spacing-sm) border-b border-line-soft px-(--c-spacing-md) py-(--c-spacing-sm) last:border-b-0">
                                <Avatar size={32} className="bg-layout! text-body! border border-line-soft">{item.initials}</Avatar>
                                <div className="min-w-0 flex-1"><p className="truncate text-(length:--c-font-size) font-medium">{item.name}</p><Text type="secondary" className="text-(length:--c-font-size-sm)!">{item.task}</Text></div>
                                <Tag color={item.tone} className="m-0! rounded-full!">{t(`dashboard.queue.${item.tone}`)}</Tag>
                            </div>
                        ))}
                    </div>
                    <Button type="text" block className="rounded-t-none! border-t border-line-soft!">{t('dashboard.queue.viewAll')}</Button>
                </Surface>

                <Surface className="xl:col-span-7" padded={false}>
                    <div className="flex flex-col gap-(--c-spacing) border-b border-line-soft p-(--c-spacing-md) sm:flex-row sm:items-center sm:justify-between">
                        <SectionTitle title={t('dashboard.activity.title')} description={t('dashboard.activity.description')} />
                        <Tag color="success" className="m-0! rounded-full!">{t('dashboard.activity.live')}</Tag>
                    </div>
                    <div className="grid grid-cols-1 divide-y divide-line-soft sm:grid-cols-3 sm:divide-x sm:divide-y-0">
                        {[
                            ['09:30', 'sync', 'Dizayn sinxronizatsiyasi'],
                            ['11:00', 'review', 'API ni tekshirish'],
                            ['14:30', 'demo', 'Sprint demo'],
                        ].map(([time, key, fallback]) => (
                            <div key={key} className="p-(--c-spacing-md)">
                                <Text className="font-mono text-(length:--c-font-size-sm)! text-brand">{time}</Text>
                                <p className="mt-(--c-spacing-sm) text-(length:--c-font-size) font-semibold">{t(`dashboard.activity.${key}`, fallback)}</p>
                                <Text type="secondary" className="mt-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">{t('dashboard.activity.owner')}</Text>
                            </div>
                        ))}
                    </div>
                </Surface>

                <Surface className="xl:col-span-5">
                    <div className="flex min-h-44 flex-col items-center justify-center text-center">
                        <div className="flex size-11 items-center justify-center rounded-(--c-border-radius-xl) bg-layout text-subtle"><Bell size={20} /></div>
                        <h2 className="mt-(--c-spacing) text-base font-semibold">{t('dashboard.empty.title')}</h2>
                        <Text type="secondary" className="mt-(--c-spacing-xs) max-w-xs text-(length:--c-font-size)!">{t('dashboard.empty.description')}</Text>
                        <Button className="mt-(--c-spacing-md)" icon={<Plus size={15} />}>{t('dashboard.empty.action')}</Button>
                    </div>
                </Surface>
            </div>
        </div>
    );
}
