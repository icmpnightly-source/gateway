import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Card, Popconfirm, Tabs, Tooltip, Typography, message } from 'antd';
import { Play, Save, SlidersHorizontal, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { WORK_VIEW_PARAM } from '@/router/routes';
import type { WorkView } from '@/router/routes';
import { useAppDispatch, useAppSelector, useGatewayUrl } from '@/store';
import { removeGatewayRule, saveGatewayRule } from '@/store/slices/gatewaySlice';
import { changeProject } from '@/store/slices/projectsSlice';
import type { GatewayRule, GatewayRulePayload, Project, TokenField } from '@/types/gateway.types';
import { copyText } from '../utils/copy';
import { MethodBadge } from './MethodBadge';
import { RULE_FORM_ID, RuleForm } from './RuleForm';
import { WorkRunner } from './run/WorkRunner';

const { Title, Text } = Typography;

const CARD = 'border-line-soft! bg-container! shadow-(--c-box-shadow-card)!';

interface WorkEditorProps {
  project: Project;
  /** The work being changed; unset to make a new one. */
  rule?: GatewayRule;
  /** Called with the work once a new one is saved, to go to it. */
  onCreated: (rule: GatewayRule) => void;
  /** Called to leave: after deleting the work, or giving up on a new one. */
  onLeave: () => void;
}

/**
 * One work, open in the page, on two tabs: its settings, and the place to
 * send it a request and see what comes back.
 */
export function WorkEditor({ project, rule, onCreated, onLeave }: WorkEditorProps) {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const [searchParams, setSearchParams] = useSearchParams();
  const rules = useAppSelector((state) => state.gateway.items);
  const gatewayUrl = useGatewayUrl();

  const [messageApi, contextHolder] = message.useMessage();
  const [isSaving, setIsSaving] = useState(false);

  // Which tab is open is part of the address; a work not saved yet has only its settings.
  const view: WorkView = rule && searchParams.get(WORK_VIEW_PARAM) === 'run' ? 'run' : 'settings';
  const show = (next: WorkView) => {
    const params = new URLSearchParams(searchParams);
    if (next === 'run') params.set(WORK_VIEW_PARAM, 'run');
    else params.delete(WORK_VIEW_PARAM);
    setSearchParams(params, { replace: true });
  };

  // Thunks reject with the engine's own message, which says more than we could.
  const showFailure = (reason: unknown) => {
    messageApi.error((typeof reason === 'string' && reason) || t('gateway.requestFailed'));
  };

  const save = async (payload: GatewayRulePayload, tokenFields?: TokenField[]) => {
    setIsSaving(true);
    try {
      const saved = await dispatch(saveGatewayRule({ payload, projectId: project.id, existing: rule })).unwrap();
      // A sample pasted while filling the form in is the project's token shape now.
      if (tokenFields) await dispatch(changeProject({ id: project.id, tokenFields })).unwrap();

      if (rule) messageApi.success(t('gateway.updated'));
      else onCreated(saved);
    } catch (reason) {
      showFailure(reason);
    } finally {
      setIsSaving(false);
    }
  };

  // The whole address a client calls the work at, ready to paste elsewhere.
  const copyAddress = async () => {
    if (!rule) return;
    const url = gatewayUrl + rule.path;
    if (await copyText(url)) messageApi.success(t('gateway.copied', { url }));
    else messageApi.error(t('gateway.copyFailed'));
  };

  const remove = async () => {
    if (!rule) return;
    try {
      await dispatch(removeGatewayRule(rule)).unwrap();
      onLeave();
    } catch (reason) {
      showFailure(reason);
    }
  };

  return (
    <div className="flex flex-col gap-(--c-spacing-sm)">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex min-w-0 items-center gap-(--c-spacing-sm)">
          {rule && <MethodBadge methods={rule.methods} className="text-sm!" />}
          <div className="min-w-0">
            <Title level={4} className="mb-0! truncate">
              {rule ? rule.name : t('gateway.newTitle')}
            </Title>
            {rule && (
              <Text type="secondary" className="block truncate font-mono text-xs!">
                <Tooltip title={t('gateway.copyUrl')}>
                  <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 font-[inherit] text-inherit hover:text-brand"
                    onClick={copyAddress}
                  >
                    {rule.path}
                  </button>
                </Tooltip>{' '}
                → {rule.destination}
              </Text>
            )}
          </div>
        </div>

        <div className="flex items-center gap-(--c-spacing-xs)">
          {rule ? (
            <Popconfirm
              title={t('gateway.deleteConfirm', { name: rule.name })}
              okText={t('gateway.delete')}
              cancelText={t('gateway.cancel')}
              okButtonProps={{ danger: true }}
              onConfirm={remove}
            >
              <Button danger aria-label={t('gateway.delete')} icon={<Trash2 size={16} />} />
            </Popconfirm>
          ) : (
            <Button onClick={onLeave}>{t('gateway.cancel')}</Button>
          )}
          {/* Saving is of the settings: there is nothing to save where requests are sent. */}
          {view === 'settings' && (
            <Button type="primary" htmlType="submit" form={RULE_FORM_ID} icon={<Save size={16} />} loading={isSaving}>
              {t('gateway.save')}
            </Button>
          )}
        </div>
      </div>

      {rule && (
        <Tabs
          activeKey={view}
          onChange={(key) => show(key as WorkView)}
          // The tabs only choose: what they show is below, both kept in place.
          className="[&_.ant-tabs-nav]:mb-0!"
          items={[
            { key: 'settings', icon: <SlidersHorizontal size={14} />, label: t('gateway.viewSettings') },
            { key: 'run', icon: <Play size={14} />, label: t('gateway.test') },
          ]}
        />
      )}

      {/* Out of sight, not gone: what was typed into the settings stays while a request is tried, and the other way round. */}
      <Card className={view === 'settings' ? CARD : 'hidden'} styles={{ body: { paddingTop: 8 } }}>
        <RuleForm
          rule={rule}
          project={project}
          others={rules.filter((other) => other.id !== rule?.id)}
          onSubmit={save}
        />
      </Card>

      {rule && (
        <Card className={view === 'run' ? CARD : 'hidden'}>
          <WorkRunner rule={rule} />
        </Card>
      )}
    </div>
  );
}
