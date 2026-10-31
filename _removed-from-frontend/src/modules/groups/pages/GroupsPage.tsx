import { useState } from 'react';
import {
  Button,
  Card,
  ColorPicker,
  Empty,
  Form,
  Input,
  Modal,
  Popconfirm,
  Table,
  Typography,
  message,
} from 'antd';
import { Pencil, Plus, Trash2, Users } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { ColumnsType } from 'antd/es/table';
import { useAppDispatch, useAppSelector } from '@/store';
import { addGroup, removeGroup, updateGroup } from '@/store/slices/groupsSlice';
import type { Group, GroupPayload } from '@/types/group.types';
import {
  DEFAULT_GROUP_COLOR,
  DEFAULT_GROUP_ICON,
  GROUP_COLORS,
  getGroupIcon,
} from '../constants/groupIcons';
import { GroupIconPicker } from '../components/GroupIconPicker';

const { Title, Text } = Typography;

export function GroupsPage() {
  const { t, i18n } = useTranslation();
  const dispatch = useAppDispatch();
  const groups = useAppSelector((state) => state.groups.items);

  const [form] = Form.useForm<GroupPayload>();
  const [messageApi, contextHolder] = message.useMessage();
  // Open with no group to create one; with a group to edit it.
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<Group>();
  // Drives the icon grid preview so icons render in the colour being picked.
  const color = Form.useWatch('color', form) ?? DEFAULT_GROUP_COLOR;

  const openCreate = () => {
    setEditing(undefined);
    setIsOpen(true);
  };

  const openEdit = (group: Group) => {
    setEditing(group);
    setIsOpen(true);
  };

  const handleSubmit = (values: GroupPayload) => {
    if (editing) {
      dispatch(updateGroup({ id: editing.id, ...values }));
      messageApi.success(t('groups.updated'));
    } else {
      dispatch(addGroup(values));
      messageApi.success(t('groups.created'));
    }
    setIsOpen(false);
  };

  const handleDelete = (group: Group) => {
    dispatch(removeGroup(group.id));
    messageApi.success(t('groups.deleted'));
  };

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString(i18n.language, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  const columns: ColumnsType<Group> = [
    {
      title: t('groups.name'),
      dataIndex: 'name',
      key: 'name',
      render: (name: string, group) => {
        const Icon = getGroupIcon(group.icon);
        const groupColor = group.color ?? DEFAULT_GROUP_COLOR;

        return (
          <div className="flex items-center gap-(--c-spacing-xs)">
            <span
              className="w-8 h-8 rounded-(--c-border-radius-lg) flex items-center justify-center shrink-0"
              style={{ backgroundColor: `${groupColor}1f` }}
            >
              <Icon size={16} color={groupColor} />
            </span>
            <Text strong>{name}</Text>
          </div>
        );
      },
    },
    {
      title: t('groups.description'),
      dataIndex: 'description',
      key: 'description',
      render: (description?: string) => description ?? <Text type="secondary">—</Text>,
    },
    {
      title: t('groups.createdAt'),
      dataIndex: 'createdAt',
      key: 'createdAt',
      responsive: ['md'],
      render: formatDate,
    },
    {
      title: t('groups.actions'),
      key: 'actions',
      align: 'right',
      width: 120,
      render: (_, group) => (
        <div className="flex justify-end gap-(--c-spacing-xxs)">
          <Button
            type="text"
            size="small"
            aria-label={t('groups.edit')}
            icon={<Pencil size={14} />}
            onClick={() => openEdit(group)}
          />
          <Popconfirm
            title={t('groups.deleteConfirm', { name: group.name })}
            okText={t('groups.delete')}
            cancelText={t('groups.cancel')}
            okButtonProps={{ danger: true }}
            onConfirm={() => handleDelete(group)}
          >
            <Button type="text" size="small" danger aria-label={t('groups.delete')} icon={<Trash2 size={14} />} />
          </Popconfirm>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-(--c-spacing-lg)">
      {contextHolder}

      <div className="flex flex-wrap items-center justify-between gap-(--c-spacing-sm)">
        <div className="flex items-center gap-(--c-spacing-sm)">
          <div className="w-10 h-10 rounded-(--c-border-radius-xl) bg-brand/10 flex items-center justify-center">
            <Users size={22} className="text-brand" />
          </div>
          <div>
            <Title level={3} className="mb-0!">
              {t('groups.title')}
            </Title>
            <Text type="secondary">{t('groups.subtitle')}</Text>
          </div>
        </div>

        <Button type="primary" icon={<Plus size={16} />} onClick={openCreate}>
          {t('groups.new')}
        </Button>
      </div>

      <Card
        className="border-line-soft! bg-container! shadow-(--c-box-shadow-card)! overflow-hidden"
        styles={{ body: { padding: 0 } }}
      >
        <Table<Group>
          rowKey="id"
          columns={columns}
          dataSource={groups}
          pagination={false}
          locale={{
            emptyText: (
              <Empty description={t('groups.empty')} image={Empty.PRESENTED_IMAGE_SIMPLE}>
                <Button type="primary" icon={<Plus size={16} />} onClick={openCreate}>
                  {t('groups.new')}
                </Button>
              </Empty>
            ),
          }}
        />
      </Card>

      <Modal
        title={editing ? t('groups.editTitle') : t('groups.newTitle')}
        open={isOpen}
        okText={t('groups.save')}
        cancelText={t('groups.cancel')}
        onOk={() => form.submit()}
        onCancel={() => setIsOpen(false)}
        // Remount the form per target so initialValues below always apply.
        destroyOnHidden
      >
        <Form
          form={form}
          layout="vertical"
          onFinish={handleSubmit}
          initialValues={{
            name: editing?.name,
            description: editing?.description,
            icon: editing?.icon ?? DEFAULT_GROUP_ICON,
            color: editing?.color ?? DEFAULT_GROUP_COLOR,
          }}
        >
          <Form.Item
            name="name"
            label={t('groups.name')}
            rules={[
              { required: true, whitespace: true, message: t('groups.nameRequired') },
              {
                validator: (_, value?: string) => {
                  const name = value?.trim().toLowerCase();
                  const taken = groups.some(
                    (group) => group.id !== editing?.id && group.name.toLowerCase() === name,
                  );
                  return taken ? Promise.reject(new Error(t('groups.nameTaken'))) : Promise.resolve();
                },
              },
            ]}
          >
            <Input autoFocus placeholder={t('groups.namePlaceholder')} />
          </Form.Item>

          <Form.Item
            name="color"
            label={t('groups.color')}
            // ColorPicker hands back a Color object; store the hex string.
            getValueFromEvent={(_, hex: string) => hex}
          >
            <ColorPicker
              showText
              disabledAlpha
              format="hex"
              presets={[{ label: t('groups.color'), colors: GROUP_COLORS }]}
            />
          </Form.Item>

          <Form.Item name="icon" label={t('groups.icon')}>
            <GroupIconPicker color={color} />
          </Form.Item>

          <Form.Item name="description" label={t('groups.description')}>
            <Input.TextArea rows={3} placeholder={t('groups.descriptionPlaceholder')} />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
