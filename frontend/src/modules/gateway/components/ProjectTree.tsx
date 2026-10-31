import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { Button, Dropdown, Input, Modal, Tooltip, message } from 'antd';
import {
  ChevronRight,
  Download,
  Ellipsis,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Plus,
  Search,
  Trash2,
  Upload,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage } from '@/api/engine';
import { ROUTES, WORK_PARAM, WORK_VIEW_PARAM, projectPath, workPath } from '@/router/routes';
import { useAppDispatch, useAppSelector } from '@/store';
import { saveGatewayRule } from '@/store/slices/gatewaySlice';
import { changeProject, removeProject } from '@/store/slices/projectsSlice';
import type { GatewayRule, Project } from '@/types/gateway.types';
import { downloadProject } from '../utils/exportProject';
import { NAME_PATTERN } from '../utils/validation';
import { MethodBadge } from './MethodBadge';

const STORAGE_KEY = 'konggate.tree-open';
const MAX_PROJECT_NAME = 64;

function rememberedOpen(): string[] {
  try {
    const stored: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]');
    return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string') : [];
  } catch {
    return [];
  }
}

// A row's look. Nothing about it changes size when the pointer is over it:
// only colours do, and what appears then takes the place of what was there.
const ROW =
  'group relative flex h-8 w-full cursor-pointer items-center rounded-(--c-border-radius) text-start outline-none select-none focus-visible:ring-2 focus-visible:ring-brand/40 focus-visible:ring-inset';
const ROW_IDLE = 'text-body hover:bg-layout';
const ROW_ACTIVE = 'bg-brand/10 text-brand';

// A project's buttons show while the pointer or the keyboard is on its row,
// and while their menu is open; its count of works steps aside for them.
const POINTED_SHOW =
  'group-hover:flex group-focus-visible:flex group-has-[:focus-visible]:flex group-has-[.ant-dropdown-open]:flex';
const POINTED_HIDE =
  'group-hover:invisible group-focus-visible:invisible group-has-[:focus-visible]:invisible group-has-[.ant-dropdown-open]:invisible';

// Enter or space on a row does what a click on it does; keys pressed on the
// buttons inside it are theirs.
const onKey = (action: () => void) => (event: KeyboardEvent) => {
  if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return;
  event.preventDefault();
  action();
};

/** How an edit of a name ended: by Enter, or by leaving the field. */
type Ending = 'enter' | 'blur';

interface NameFieldProps {
  initial: string;
  label: string;
  /** Set while the new name is being saved. */
  busy: boolean;
  /** Called with what was typed. Answering "keep" leaves the field open, to put the name right. */
  onDone: (name: string, ending: Ending) => 'keep' | undefined;
  onCancel: () => void;
}

/** A name being changed where it stands: Enter or leaving the field keeps it, Escape drops it. */
function NameField({ initial, label, busy, onDone, onCancel }: NameFieldProps) {
  const [value, setValue] = useState(initial);
  // Leaving the field follows Enter and Escape too; the edit ends only once.
  const ended = useRef(false);

  const end = (ending: Ending) => {
    if (ended.current) return;
    ended.current = true;
    if (onDone(value, ending) === 'keep') ended.current = false;
  };

  return (
    <input
      autoFocus
      value={value}
      disabled={busy}
      aria-label={label}
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      // The row under the field does nothing while its name is typed.
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === 'Enter') end('enter');
        if (event.key === 'Escape') {
          ended.current = true;
          onCancel();
        }
      }}
      onBlur={() => end('blur')}
      className="h-6 min-w-0 flex-1 cursor-text rounded border border-brand bg-container px-1 font-[inherit] text-body outline-none select-text"
    />
  );
}

/** What is being renamed in the tree, if anything. */
type Renaming = { project: Project; rule?: undefined } | { rule: GatewayRule; project?: undefined };

interface ProjectTreeProps {
  onCreateProject: () => void;
  onImport: () => void;
}

/** Every project with its works under it: the way around the app, and where a project is renamed, exported and deleted. */
export function ProjectTree({ onCreateProject, onImport }: ProjectTreeProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const dispatch = useAppDispatch();
  const [searchParams] = useSearchParams();
  const [messageApi, contextHolder] = message.useMessage();
  const [confirm, confirmHolder] = Modal.useModal();

  const projects = useAppSelector((state) => state.projects.items);
  const rules = useAppSelector((state) => state.gateway.items);

  const activeProjectId = location.pathname.startsWith('/projects/') ? location.pathname.split('/')[2] : undefined;
  const activeWork = activeProjectId ? searchParams.get(WORK_PARAM) : null;
  // Going from one work to another keeps to the tab that is open.
  const view = searchParams.get(WORK_VIEW_PARAM) === 'run' ? 'run' : 'settings';

  const [search, setSearch] = useState('');
  const [open, setOpen] = useState<string[]>(rememberedOpen);
  const [renaming, setRenaming] = useState<Renaming>();
  const [isSavingName, setIsSavingName] = useState(false);

  // Going to a project opens it in the tree; after that it closes and opens
  // like any other.
  const [arrivedAt, setArrivedAt] = useState<string>();
  if (activeProjectId !== arrivedAt) {
    setArrivedAt(activeProjectId);
    if (activeProjectId && !open.includes(activeProjectId)) setOpen([...open, activeProjectId]);
  }

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(open));
    } catch {
      // Storage disabled: the tree just starts closed next time.
    }
  }, [open]);

  const toggle = (id: string) =>
    setOpen((ids) => (ids.includes(id) ? ids.filter((other) => other !== id) : [...ids, id]));

  const wanted = search.trim().toLowerCase();
  const matches = (rule: GatewayRule) =>
    [rule.name, rule.path, rule.destination].some((value) => value.toLowerCase().includes(wanted));

  // With a search on, a project shows if its name matches (with all its
  // works) or if any of its works does (with just those).
  const shown = projects.flatMap((project) => {
    const works = rules.filter((rule) => rule.projectId === project.id);
    if (!wanted) return [{ project, works, total: works.length }];

    const nameMatches = project.name.toLowerCase().includes(wanted);
    const found = nameMatches ? works : works.filter(matches);
    return nameMatches || found.length > 0 ? [{ project, works: found, total: works.length }] : [];
  });

  // Thunks reject with the engine's own message, which says more than we could.
  const showFailure = (reason: unknown) => {
    messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
  };

  const exportIt = async (project: Project) => {
    try {
      await downloadProject(project);
    } catch (error) {
      showFailure(engineErrorMessage(error));
    }
  };

  // A project goes only once it is empty, so that works are never deleted by the dozen in one click.
  const deleteIt = (project: Project) => {
    if (rules.some((rule) => rule.projectId === project.id)) {
      messageApi.warning(t('projects.deleteHasWorks'));
      return;
    }

    void confirm.confirm({
      title: t('projects.deleteConfirm', { name: project.name }),
      okText: t('projects.delete'),
      cancelText: t('projects.cancel'),
      okButtonProps: { danger: true },
      onOk: async () => {
        try {
          await dispatch(removeProject(project.id)).unwrap();
          if (project.id === activeProjectId) navigate(ROUTES.HOME);
        } catch (reason) {
          showFailure(reason);
        }
      },
    });
  };

  // What is wrong with the name typed, in words; nothing when it will do.
  const problemWith = (name: string, target: Renaming) => {
    if (target.project) {
      if (name.length > MAX_PROJECT_NAME) return t('projects.nameTooLong');
      const isTaken = projects.some((other) => other.id !== target.project.id && other.name === name);
      return isTaken ? t('projects.nameTaken') : undefined;
    }

    if (!NAME_PATTERN.test(name)) return t('gateway.nameInvalid');
    const isTaken = rules.some(
      (other) => other.projectId === target.rule.projectId && other.id !== target.rule.id && other.name === name,
    );
    return isTaken ? t('gateway.nameTaken') : undefined;
  };

  const saveName = async (name: string, target: Renaming) => {
    setIsSavingName(true);
    try {
      if (target.project) {
        await dispatch(changeProject({ id: target.project.id, name })).unwrap();
      } else {
        const { rule } = target;
        await dispatch(saveGatewayRule({ payload: { ...rule, name }, projectId: rule.projectId, existing: rule })).unwrap();
      }
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSavingName(false);
      setRenaming(undefined);
    }
  };

  const endRename = (typed: string, ending: Ending): 'keep' | undefined => {
    if (!renaming) return undefined;
    const name = typed.trim();
    const before = renaming.project ? renaming.project.name : renaming.rule.name;
    // Nothing typed, or the same again: nothing to save.
    if (!name || name === before) {
      setRenaming(undefined);
      return undefined;
    }

    const problem = problemWith(name, renaming);
    if (problem) {
      messageApi.error(problem);
      // After Enter the field stays, to put the name right; left behind, it closes.
      if (ending === 'enter') return 'keep';
      setRenaming(undefined);
      return undefined;
    }

    void saveName(name, renaming);
    return undefined;
  };

  return (
    <aside className="flex h-dvh w-72 shrink-0 flex-col border-r border-line-soft bg-container">
      {contextHolder}
      {confirmHolder}

      <div className="flex h-14 shrink-0 items-center justify-between ps-(--c-spacing) pe-(--c-spacing-sm)">
        <span className="text-base font-semibold">{t('tree.title')}</span>
        <Dropdown
          trigger={['click']}
          placement="bottomRight"
          menu={{
            items: [
              { key: 'project', icon: <FolderPlus size={14} />, label: t('tree.newProject'), onClick: onCreateProject },
              { key: 'import', icon: <Upload size={14} />, label: t('projects.import'), onClick: onImport },
            ],
          }}
        >
          <Button type="primary" size="small" shape="circle" aria-label={t('tree.add')} icon={<Plus size={14} />} />
        </Dropdown>
      </div>

      <div className="shrink-0 px-(--c-spacing-sm) pb-(--c-spacing-xs)">
        <Input
          allowClear
          size="small"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          prefix={<Search size={14} className="text-subtle" />}
          placeholder={t('tree.search')}
          aria-label={t('tree.search')}
        />
      </div>

      {/* The scrollbar's room is always kept, so the rows never move when it comes and goes. */}
      <div
        role="tree"
        className="content-scrollbar min-h-0 flex-1 overflow-y-auto px-(--c-spacing-xs) pb-(--c-spacing-sm) [scrollbar-gutter:stable]"
      >
        {shown.length === 0 && (
          <div className="px-(--c-spacing-sm) py-(--c-spacing) text-(length:--c-font-size-sm) text-subtle">
            {projects.length === 0 ? t('tree.empty') : t('tree.noMatch')}
          </div>
        )}

        {shown.map(({ project, works, total }) => {
          const expanded = Boolean(wanted) || open.includes(project.id);
          const isActive = project.id === activeProjectId && !activeWork;
          const isRenamed = renaming?.project?.id === project.id;
          // Going where one already is would only pile the same page up in the history.
          const openProject = () => {
            if (!isActive) navigate(projectPath(project.id));
          };

          return (
            <div key={project.id} role="group">
              <div
                role="treeitem"
                tabIndex={0}
                aria-expanded={expanded}
                aria-selected={isActive}
                className={`${ROW} gap-1 ps-1 pe-1 ${isActive ? ROW_ACTIVE : ROW_IDLE}`}
                onClick={openProject}
                onDoubleClick={() => setRenaming({ project })}
                onKeyDown={onKey(openProject)}
              >
                <button
                  type="button"
                  aria-label={expanded ? t('tree.collapse') : t('tree.expand')}
                  className="flex size-5 shrink-0 cursor-pointer items-center justify-center rounded border-0 bg-transparent p-0 text-subtle hover:text-body"
                  onClick={(event) => {
                    event.stopPropagation();
                    toggle(project.id);
                  }}
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <ChevronRight size={14} className={expanded ? 'rotate-90' : ''} />
                </button>
                {expanded ? <FolderOpen size={16} className="shrink-0" /> : <Folder size={16} className="shrink-0" />}

                {isRenamed ? (
                  <NameField
                    initial={project.name}
                    label={t('projects.name')}
                    busy={isSavingName}
                    onDone={endRename}
                    onCancel={() => setRenaming(undefined)}
                  />
                ) : (
                  <span className="min-w-0 flex-1 truncate font-medium">{project.name}</span>
                )}

                {/* The count and the buttons take turns in one box of a set width: showing the buttons moves nothing. */}
                {!isRenamed && (
                  <span className="relative flex h-full w-14 shrink-0 items-center justify-end">
                    <span className={`pe-1 text-xs text-subtle tabular-nums ${POINTED_HIDE}`}>({total})</span>
                    <span
                      className={`absolute inset-y-0 end-0 hidden items-center gap-0.5 ${POINTED_SHOW}`}
                      onClick={(event) => event.stopPropagation()}
                      onDoubleClick={(event) => event.stopPropagation()}
                    >
                      <Tooltip title={t('gateway.new')}>
                        <Button
                          type="text"
                          size="small"
                          aria-label={t('gateway.new')}
                          icon={<Plus size={14} />}
                          onClick={() => navigate(workPath(project.id, 'new'))}
                        />
                      </Tooltip>
                      <Dropdown
                        trigger={['click']}
                        menu={{
                          items: [
                            {
                              key: 'rename',
                              icon: <Pencil size={14} />,
                              label: t('projects.rename'),
                              onClick: () => setRenaming({ project }),
                            },
                            {
                              key: 'export',
                              icon: <Download size={14} />,
                              label: t('projects.export'),
                              onClick: () => void exportIt(project),
                            },
                            { type: 'divider' },
                            {
                              key: 'delete',
                              icon: <Trash2 size={14} />,
                              label: t('projects.delete'),
                              danger: true,
                              onClick: () => deleteIt(project),
                            },
                          ],
                        }}
                      >
                        <Button type="text" size="small" aria-label={t('tree.more')} icon={<Ellipsis size={14} />} />
                      </Dropdown>
                    </span>
                  </span>
                )}
              </div>

              {expanded &&
                works.map((rule) => {
                  const isSelected = rule.id === activeWork && project.id === activeProjectId;
                  const isRuleRenamed = renaming?.rule?.id === rule.id;
                  const openWork = () => {
                    if (!isSelected) navigate(workPath(project.id, rule.id, view));
                  };

                  return (
                    <div
                      key={rule.id}
                      role="treeitem"
                      tabIndex={0}
                      aria-selected={isSelected}
                      title={isRuleRenamed ? undefined : `${rule.path} → ${rule.destination}`}
                      className={`${ROW} gap-2 ps-9 pe-2 ${isSelected ? ROW_ACTIVE : ROW_IDLE}`}
                      onClick={openWork}
                      onDoubleClick={() => setRenaming({ rule })}
                      onKeyDown={onKey(openWork)}
                    >
                      <MethodBadge methods={rule.methods} />
                      {isRuleRenamed ? (
                        <NameField
                          initial={rule.name}
                          label={t('gateway.name')}
                          busy={isSavingName}
                          onDone={endRename}
                          onCancel={() => setRenaming(undefined)}
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate">{rule.name}</span>
                      )}
                    </div>
                  );
                })}

              {expanded && works.length === 0 && (
                <div className="flex h-8 items-center ps-9 text-(length:--c-font-size-sm) text-subtle">
                  {wanted ? t('tree.noMatch') : t('tree.noWorks')}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </aside>
  );
}
