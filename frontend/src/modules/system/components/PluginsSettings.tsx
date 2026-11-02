import { useEffect, useState } from 'react';
import { Alert, Button, Tag, Typography, message } from 'antd';
import { FolderOpen, RefreshCw } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { engineErrorMessage } from '@/api/engine';
import { openPluginsFolder } from '@/api/plugins';
import { useAppDispatch, useAppSelector } from '@/store';
import { loadPlugins, reloadPluginsFolder } from '@/store/slices/pluginsSlice';
import { pluginDescription, pluginTitle } from '@/modules/gateway/utils/plugins';

const { Text } = Typography;

/**
 * The plugins this computer has: the built-in ones, and the files of the
 * plugins folder, which is read again on request after a file is added or
 * changed. A file that could not be used is listed with the reason.
 */
export function PluginsSettings() {
  const { t } = useTranslation();
  const dispatch = useAppDispatch();
  const { info, status } = useAppSelector((state) => state.plugins);
  const [messageApi, contextHolder] = message.useMessage();
  const [isReloading, setIsReloading] = useState(false);

  useEffect(() => {
    void dispatch(loadPlugins());
  }, [dispatch]);

  const reload = async () => {
    setIsReloading(true);
    try {
      const read = await dispatch(reloadPluginsFolder()).unwrap();
      const custom = read.plugins.filter((plugin) => !plugin.builtIn).length;
      messageApi.success(t('system.pluginsReloaded', { n: custom }));
    } catch (reason) {
      messageApi.error(engineErrorMessage(reason) || t('system.pluginsReloadFailed'));
    } finally {
      setIsReloading(false);
    }
  };

  const openFolder = async () => {
    try {
      await openPluginsFolder();
    } catch (reason) {
      messageApi.error(engineErrorMessage(reason) || t('system.pluginsOpenFailed'));
    }
  };

  if (!info) {
    return status === 'failed' ? <Alert type="error" showIcon title={t('system.pluginsUnreadable')} /> : null;
  }

  const builtIn = info.plugins.filter((plugin) => plugin.builtIn);
  const custom = info.plugins.filter((plugin) => !plugin.builtIn);

  return (
    <div className="flex flex-col gap-(--c-spacing)">
      {contextHolder}

      <div className="flex flex-col gap-(--c-spacing-xs)">
        <Text strong>{t('system.pluginsFolder')}</Text>
        {info.folder && (
          <Text code copyable className="block break-all">
            {info.folder}
          </Text>
        )}
        <Text type="secondary">{t('system.pluginsFolderHint')}</Text>
        <div className="flex flex-wrap gap-(--c-spacing-xs)">
          {info.canOpenFolder && (
            <Button icon={<FolderOpen size={14} />} onClick={() => void openFolder()}>
              {t('system.pluginsOpenFolder')}
            </Button>
          )}
          <Button icon={<RefreshCw size={14} />} loading={isReloading} onClick={() => void reload()}>
            {t('system.pluginsReload')}
          </Button>
        </div>
        <Alert type="warning" showIcon title={t('system.pluginsTrust')} />
      </div>

      {info.errors.map((error) => (
        <Alert
          key={error.file}
          type="error"
          showIcon
          title={t('system.pluginsNotUsed', { file: error.file })}
          description={<span className="font-mono text-xs">{error.message}</span>}
        />
      ))}

      <div className="flex flex-col gap-(--c-spacing-xs)">
        <Text strong>{t('system.pluginsCustom', { n: custom.length })}</Text>
        {custom.length === 0 && <Text type="secondary">{t('system.pluginsNoCustom')}</Text>}
        {custom.map((plugin) => (
          <div key={plugin.name} className="flex flex-col">
            <span className="flex flex-wrap items-center gap-(--c-spacing-xs)">
              <Text strong>{plugin.title}</Text>
              <Text code>{plugin.file}</Text>
            </span>
            {plugin.description && <Text type="secondary">{plugin.description}</Text>}
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-(--c-spacing-xs)">
        <Text strong>{t('system.pluginsBuiltIn', { n: builtIn.length })}</Text>
        {builtIn.map((plugin) => (
          <div key={plugin.name} className="flex flex-col">
            <span className="flex flex-wrap items-center gap-(--c-spacing-xs)">
              <Text strong>{pluginTitle(t, plugin.name, plugin)}</Text>
              <Tag className="me-0!">{plugin.name}</Tag>
            </span>
            <Text type="secondary">{pluginDescription(t, plugin)}</Text>
          </div>
        ))}
      </div>
    </div>
  );
}
