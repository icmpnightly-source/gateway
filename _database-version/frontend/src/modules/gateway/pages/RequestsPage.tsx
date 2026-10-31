import { useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import {
  Alert,
  Button,
  Card,
  Drawer,
  Empty,
  Input,
  Popconfirm,
  Segmented,
  Select,
  Spin,
  Switch,
  Table,
  Tag,
  Tooltip,
  Typography,
} from 'antd';
import { ArrowDown, FilterX, RefreshCw, ScrollText, Search, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { clearRequests, fetchRequest, fetchRequests } from '@/api/system';
import { REQUEST_PARAMS, workPath } from '@/router/routes';
import { useAppSelector } from '@/store';
import type { RecordedMessage, RequestRecord, RequestSummary } from '@/types/system.types';

const { Title, Text } = Typography;

// How often the list is read again while it refreshes by itself.
const REFRESH_EVERY_MS = 3000;

type Outcome = 'all' | 'ok' | 'failed';

// Stands in the code filter for requests that got no answer at all.
const NO_ANSWER = 0;

const isOk = (status: number | null) => status !== null && status < 400;

function statusColor(status: number | null) {
  if (status === null) return 'default';
  if (status < 400) return 'success';
  return status < 500 ? 'warning' : 'error';
}

/** A body as it is easiest to read: JSON laid out, anything else as it is. */
function pretty(body: string) {
  try {
    return JSON.stringify(JSON.parse(body), null, 2);
  } catch {
    return body;
  }
}

const BLOCK =
  'content-scrollbar m-0 overflow-auto rounded-(--c-border-radius) border border-line-soft bg-layout p-(--c-spacing-sm) font-mono text-xs leading-relaxed';

function Labelled({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <Text type="secondary" className="mb-(--c-spacing-xxs) block text-(length:--c-font-size-sm)!">
        {label}
      </Text>
      {children}
    </div>
  );
}

/** A message's headers, and its body when one was recorded. */
function Message({ message }: { message: RecordedMessage }) {
  const { t } = useTranslation();

  return (
    <>
      <Labelled label={t('requests.headers')}>
        <pre className={`${BLOCK} max-h-64`}>
          {Object.entries(message.headers).map(([name, value]) => (
            <div key={name} className="break-all whitespace-pre-wrap">
              <span className="text-subtle">{name}:</span> {value}
            </div>
          ))}
        </pre>
      </Labelled>
      {message.body !== undefined && (
        <Labelled label={t('requests.body')}>
          <pre className={`${BLOCK} max-h-72 break-all whitespace-pre-wrap`}>{pretty(message.body)}</pre>
        </Labelled>
      )}
    </>
  );
}

function Step({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-(--c-spacing-xs)">
      <Title level={5} className="mb-0!">
        {title}
      </Title>
      {children}
    </section>
  );
}

const Then = () => (
  <div className="flex justify-center text-subtle">
    <ArrowDown size={16} />
  </div>
);

/** One recorded request, step by step: in, on to the destination, its answer, back to the client. */
function RequestDetails({ record }: { record: RequestRecord }) {
  const { t } = useTranslation();
  const { in: incoming, out, answer } = record;
  // Bodies are only there for works that record them.
  const recordsBodies = useAppSelector(
    (state) => state.gateway.items.find((rule) => rule.id === record.workId)?.tracing.body,
  );

  return (
    <div className="flex flex-col gap-(--c-spacing)">
      {recordsBodies === false && (
        <Alert
          type="info"
          showIcon
          title={t('requests.bodyOff')}
          action={
            <RouterLink to={workPath(record.projectId, record.workId)}>
              <Button size="small">{t('requests.openWork')}</Button>
            </RouterLink>
          }
        />
      )}

      <Step title={t('requests.cameIn')}>
        <Text code className="break-all">
          {incoming.method} {incoming.url}
        </Text>
        <Text type="secondary">
          {t('requests.clientIp')}: {incoming.clientIp}
        </Text>
        <Message message={incoming} />
      </Step>

      <Then />

      <Step title={t('requests.wentOut')}>
        {out.sent ? (
          <>
            <Text code className="break-all">
              {out.method} {out.url}
            </Text>
            {out.ip && (
              <Text type="secondary">
                {t('requests.destinationIp')}: {out.ip}
              </Text>
            )}
            {/* The body is passed on untouched, so there is one copy of it: above. */}
            <Message message={{ headers: out.headers ?? {} }} />
            {incoming.body !== undefined && <Text type="secondary">{t('requests.sameBody')}</Text>}
          </>
        ) : (
          <Alert type="info" showIcon title={t('requests.notSent', { status: record.status ?? '—' })} />
        )}
      </Step>

      {out.sent && (
        <>
          <Then />
          <Step title={t('requests.answered')}>
            {out.response ? (
              <>
                <div>
                  <Tag color={statusColor(out.response.status)}>{out.response.status}</Tag>
                </div>
                <Message message={out.response} />
              </>
            ) : out.failed ? (
              <Alert
                type="error"
                showIcon
                title={t(`gateway.tester.why.${out.failed.reason}`, { defaultValue: out.failed.message })}
                description={out.failed.message}
              />
            ) : (
              <Alert type="warning" showIcon title={t('requests.noResponse')} />
            )}
          </Step>
        </>
      )}

      <Then />

      <Step title={t('requests.gaveClient')}>
        {answer ? (
          <>
            <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
              <Tag color={statusColor(record.status)} className="me-0!">
                {record.status ?? '—'}
              </Tag>
              <Text type="secondary">
                {answer.by === 'gateway' ? t('requests.byGatewayFull') : t('requests.byDestinationFull')}
              </Text>
            </div>
            <Message message={answer} />
          </>
        ) : (
          <Alert type="warning" showIcon title={t('requests.clientGone')} />
        )}
      </Step>
    </div>
  );
}

/** What went through this computer's gateway, for the works that record it. */
export function RequestsPage() {
  const { t, i18n } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const rules = useAppSelector((state) => state.gateway.items);
  const projects = useAppSelector((state) => state.projects.items);

  const projectId = searchParams.get(REQUEST_PARAMS.project) ?? undefined;
  const workId = searchParams.get(REQUEST_PARAMS.work) ?? undefined;
  const openId = searchParams.get(REQUEST_PARAMS.open) ?? undefined;

  const [items, setItems] = useState<RequestSummary[]>();
  const [isRefreshing, setIsRefreshing] = useState(true);
  // Goes up to have the list read again right now.
  const [readAgain, setReadAgain] = useState(0);
  // The request last fetched in full, with the id it was fetched for.
  const [fetched, setFetched] = useState<{ id: string; record: RequestRecord | 'gone' }>();

  // Narrowing down what was read: none of it asks the engine again.
  const [outcome, setOutcome] = useState<Outcome>('all');
  const [codes, setCodes] = useState<number[]>([]);
  const [methods, setMethods] = useState<string[]>([]);
  const [search, setSearch] = useState('');

  useEffect(() => {
    let isCurrent = true;
    const read = () =>
      fetchRequests({ projectId, workId })
        .then((found) => isCurrent && setItems(found))
        // The banner on top of every page already says the engine is away.
        .catch(() => undefined);

    void read();
    const timer = isRefreshing ? setInterval(read, REFRESH_EVERY_MS) : undefined;
    return () => {
      isCurrent = false;
      clearInterval(timer);
    };
  }, [projectId, workId, isRefreshing, readAgain]);

  useEffect(() => {
    if (!openId) return undefined;

    let isCurrent = true;
    fetchRequest(openId)
      .then((record) => isCurrent && setFetched({ id: openId, record }))
      .catch(() => isCurrent && setFetched({ id: openId, record: 'gone' }));
    return () => {
      isCurrent = false;
    };
  }, [openId]);

  const opened = fetched && fetched.id === openId ? fetched.record : undefined;

  const setParam = (name: string, value?: string) => {
    const next = new URLSearchParams(searchParams);
    if (value) next.set(name, value);
    else next.delete(name);
    setSearchParams(next);
  };

  const clear = async () => {
    await clearRequests();
    setReadAgain((count) => count + 1);
  };

  const pathOf = (item: RequestSummary) => item.url.replace(/^https?:\/\/[^/]+/, '');

  // Everything but the success/failure choice, so that choice can show how
  // many requests each side of it holds.
  const narrowed = useMemo(() => {
    const wanted = search.trim().toLowerCase();
    return (items ?? []).filter(
      (item) =>
        (codes.length === 0 || codes.includes(item.status ?? NO_ANSWER)) &&
        (methods.length === 0 || methods.includes(item.method)) &&
        (wanted === '' || item.url.toLowerCase().includes(wanted)),
    );
  }, [items, codes, methods, search]);

  const succeeded = narrowed.filter((item) => isOk(item.status)).length;
  const visible = narrowed.filter((item) => outcome === 'all' || isOk(item.status) === (outcome === 'ok'));

  // The codes and methods there are to choose from: the ones that occurred.
  const countBy = <Key,>(keyOf: (item: RequestSummary) => Key) => {
    const counts = new Map<Key, number>();
    for (const item of items ?? []) counts.set(keyOf(item), (counts.get(keyOf(item)) ?? 0) + 1);
    return counts;
  };
  const codeOptions = [...countBy((item) => item.status ?? NO_ANSWER)]
    .sort(([a], [b]) => a - b)
    .map(([code, count]) => ({
      value: code,
      label: `${code === NO_ANSWER ? t('requests.noAnswer') : code} (${count})`,
    }));
  const methodOptions = [...countBy((item) => item.method)]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([method, count]) => ({ value: method, label: `${method} (${count})` }));

  const isNarrowed = outcome !== 'all' || codes.length > 0 || methods.length > 0 || search.trim() !== '';
  const resetFilters = () => {
    setOutcome('all');
    setCodes([]);
    setMethods([]);
    setSearch('');
  };

  const time = new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const projectName = (id: string) => projects.find((project) => project.id === id)?.name;

  const columns: ColumnsType<RequestSummary> = [
    {
      title: t('requests.time'),
      dataIndex: 'time',
      key: 'time',
      width: 110,
      sorter: (a, b) => a.time.localeCompare(b.time),
      defaultSortOrder: 'descend',
      // Never unsorted: the newest or the oldest on top.
      sortDirections: ['descend', 'ascend', 'descend'],
      render: (value: string) => <Text className="tabular-nums">{time.format(new Date(value))}</Text>,
    },
    {
      title: t('requests.work'),
      key: 'work',
      sorter: (a, b) => a.workName.localeCompare(b.workName),
      render: (_, item) => (
        <div className="flex flex-col">
          <Text strong>{item.workName}</Text>
          <Text type="secondary" className="text-(length:--c-font-size-sm)!">
            {projectName(item.projectId)}
          </Text>
        </div>
      ),
    },
    {
      title: t('requests.request'),
      key: 'request',
      render: (_, item) => (
        <div className="flex items-center gap-(--c-spacing-xxs)">
          <Tag className="me-0!">{item.method}</Tag>
          <Text code className="break-all">
            {pathOf(item)}
          </Text>
        </div>
      ),
    },
    {
      title: t('requests.status'),
      key: 'status',
      width: 190,
      // Requests that got no answer sort after every code.
      sorter: (a, b) => (a.status ?? 1000) - (b.status ?? 1000),
      render: (_, item) => (
        <div className="flex flex-col items-start gap-(--c-spacing-xxs)">
          {item.status === null ? (
            <Tooltip title={t('requests.clientGone')}>
              <Tag className="me-0!">—</Tag>
            </Tooltip>
          ) : (
            <Tag color={statusColor(item.status)} className="me-0!">
              {item.status}
            </Tag>
          )}
          {/* Whose word the code is, when it is not simply the destination's. */}
          {item.failed ? (
            <Text type="danger" className="text-(length:--c-font-size-sm)!">
              {t(`requests.reasons.${item.failed}`, { defaultValue: item.failed })}
            </Text>
          ) : (
            item.answeredBy === 'gateway' && (
              <Text type="secondary" className="text-(length:--c-font-size-sm)!">
                {t('requests.byGateway')}
              </Text>
            )
          )}
        </div>
      ),
    },
    {
      title: t('requests.duration'),
      dataIndex: 'durationMs',
      key: 'duration',
      width: 130,
      align: 'right',
      sorter: (a, b) => a.durationMs - b.durationMs,
      render: (value: number) => <Text className="tabular-nums">{t('requests.took', { ms: value })}</Text>,
    },
    {
      title: t('requests.destination'),
      key: 'destination',
      responsive: ['lg'],
      render: (_, item) =>
        item.destination ? (
          <Text code className="break-all">
            {item.destination}
          </Text>
        ) : (
          <Text type="secondary">{t('requests.answeredByGateway')}</Text>
        ),
    },
  ];

  const workOptions = rules
    .filter((rule) => !projectId || rule.projectId === projectId)
    .map((rule) => ({ value: rule.id, label: `${projectName(rule.projectId) ?? ''} / ${rule.name}` }));

  return (
    <div className="flex flex-col gap-(--c-spacing-lg)">
      <div className="flex min-w-0 items-center gap-(--c-spacing-sm)">
        <div className="w-10 h-10 shrink-0 rounded-(--c-border-radius-xl) bg-brand/10 flex items-center justify-center">
          <ScrollText size={22} className="text-brand" />
        </div>
        <div className="min-w-0">
          <Title level={3} className="mb-0!">
            {t('requests.title')}
          </Title>
          <Text type="secondary">{t('requests.subtitle')}</Text>
        </div>
      </div>

      <div className="flex flex-col gap-(--c-spacing-sm)">
        <div className="flex flex-wrap items-center gap-(--c-spacing-sm)">
          <Segmented<Outcome>
            value={outcome}
            onChange={setOutcome}
            options={[
              { value: 'all', label: `${t('requests.outcomeAll')} (${narrowed.length})` },
              { value: 'ok', label: `${t('requests.outcomeOk')} (${succeeded})` },
              { value: 'failed', label: `${t('requests.outcomeFailed')} (${narrowed.length - succeeded})` },
            ]}
          />
          <label className="flex items-center gap-(--c-spacing-xs)">
            <Switch size="small" checked={isRefreshing} onChange={setIsRefreshing} />
            <Text type="secondary">{t('requests.autoRefresh')}</Text>
          </label>
          <div className="ms-auto flex items-center gap-(--c-spacing-xs)">
            <Tooltip title={t('gateway.refresh')}>
              <Button
                aria-label={t('gateway.refresh')}
                icon={<RefreshCw size={16} />}
                onClick={() => setReadAgain((count) => count + 1)}
              />
            </Tooltip>
            <Popconfirm
              title={t('requests.clearConfirm')}
              okText={t('requests.clear')}
              cancelText={t('gateway.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={clear}
            >
              <Button danger icon={<Trash2 size={16} />} disabled={!items?.length}>
                {t('requests.clear')}
              </Button>
            </Popconfirm>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-(--c-spacing-sm)">
          <Select
            allowClear
            showSearch
            optionFilterProp="label"
            value={workId}
            onChange={(value?: string) => setParam(REQUEST_PARAMS.work, value)}
            options={workOptions}
            placeholder={t('requests.allWorks')}
            aria-label={t('requests.work')}
            className="min-w-56"
          />
          <Select<number[]>
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            value={codes}
            onChange={setCodes}
            options={codeOptions}
            placeholder={t('requests.codes')}
            aria-label={t('requests.codes')}
            className="min-w-44"
          />
          <Select<string[]>
            mode="multiple"
            allowClear
            maxTagCount="responsive"
            value={methods}
            onChange={setMethods}
            options={methodOptions}
            placeholder={t('requests.methods')}
            aria-label={t('requests.methods')}
            className="min-w-36"
          />
          <Input
            allowClear
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            prefix={<Search size={14} className="text-subtle" />}
            placeholder={t('requests.search')}
            aria-label={t('requests.search')}
            className="w-64!"
          />
          {isNarrowed && (
            <Button type="link" icon={<FilterX size={14} />} onClick={resetFilters} className="px-0!">
              {t('requests.resetFilters')}
            </Button>
          )}
          {items && (
            <Text type="secondary" className="ms-auto tabular-nums">
              {t('requests.shown', { shown: visible.length, total: items.length })}
            </Text>
          )}
        </div>
      </div>

      <Card
        className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)! overflow-hidden"
        styles={{ body: { padding: 0 } }}
      >
        <Table<RequestSummary>
          rowKey="id"
          size="middle"
          columns={columns}
          dataSource={visible}
          loading={items === undefined}
          pagination={{ pageSize: 50, hideOnSinglePage: true, showSizeChanger: false }}
          scroll={{ x: 'max-content' }}
          showSorterTooltip={false}
          onRow={(item) => ({
            onClick: () => setParam(REQUEST_PARAMS.open, item.id),
            className: 'cursor-pointer',
          })}
          locale={{
            emptyText: (
              <Empty
                description={items?.length ? t('requests.emptyFiltered') : t('requests.empty')}
                image={Empty.PRESENTED_IMAGE_SIMPLE}
              >
                {Boolean(items?.length) && <Button onClick={resetFilters}>{t('requests.resetFilters')}</Button>}
              </Empty>
            ),
          }}
        />
      </Card>

      <Drawer
        title={
          opened && opened !== 'gone' ? (
            <span className="flex flex-wrap items-center gap-(--c-spacing-xs)">
              {opened.workName}
              <Tag color={statusColor(opened.status)} className="me-0!">
                {opened.status ?? '—'}
              </Tag>
              <Text type="secondary" className="font-normal tabular-nums">
                {time.format(new Date(opened.time))} · {t('requests.took', { ms: opened.durationMs })}
              </Text>
            </span>
          ) : (
            t('requests.detailsTitle')
          )
        }
        open={Boolean(openId)}
        size="large"
        onClose={() => setParam(REQUEST_PARAMS.open)}
        destroyOnHidden
      >
        {opened === undefined && (
          <div className="flex justify-center py-(--c-spacing-xl)">
            <Spin />
          </div>
        )}
        {opened === 'gone' && <Empty description={t('requests.gone')} image={Empty.PRESENTED_IMAGE_SIMPLE} />}
        {opened && opened !== 'gone' && <RequestDetails record={opened} />}
      </Drawer>
    </div>
  );
}
