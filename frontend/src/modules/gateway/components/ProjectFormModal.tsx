import { Form, Input, Modal } from 'antd';
import { useTranslation } from 'react-i18next';
import type { Project } from '@/types/gateway.types';

// Ties the dialog's Save button to the form, which lives in a child component.
const FORM_ID = 'gateway-project-form';

interface ProjectFormProps {
  project?: Project;
  others: Project[];
  onSubmit: (name: string) => void;
}

function ProjectForm({ project, others, onSubmit }: ProjectFormProps) {
  const { t } = useTranslation();

  return (
    <Form<{ name: string }>
      id={FORM_ID}
      layout="vertical"
      initialValues={{ name: project?.name ?? '' }}
      onFinish={({ name }) => onSubmit(name.trim())}
    >
      <Form.Item
        name="name"
        label={t('projects.name')}
        className="mb-0!"
        rules={[
          { required: true, whitespace: true, message: t('projects.nameRequired') },
          { max: 64, message: t('projects.nameTooLong') },
          {
            validator: (_, value?: string) =>
              others.some((other) => other.name === value?.trim())
                ? Promise.reject(new Error(t('projects.nameTaken')))
                : Promise.resolve(),
          },
        ]}
      >
        <Input autoFocus placeholder={t('projects.namePlaceholder')} />
      </Form.Item>
    </Form>
  );
}

interface ProjectFormModalProps {
  open: boolean;
  /** The project being renamed; unset to create one. */
  project?: Project;
  /** Every existing project, to keep names from clashing. */
  projects: Project[];
  saving: boolean;
  onSubmit: (name: string) => void;
  onCancel: () => void;
}

export function ProjectFormModal({ open, project, projects, saving, onSubmit, onCancel }: ProjectFormModalProps) {
  const { t } = useTranslation();

  return (
    <Modal
      title={project ? t('projects.renameTitle') : t('projects.newTitle')}
      open={open}
      okText={t('projects.save')}
      cancelText={t('projects.cancel')}
      confirmLoading={saving}
      okButtonProps={{ htmlType: 'submit', form: FORM_ID }}
      onCancel={onCancel}
      // Remounted per target, so the field always starts from that project.
      destroyOnHidden
    >
      <ProjectForm
        project={project}
        others={projects.filter((other) => other.id !== project?.id)}
        onSubmit={onSubmit}
      />
    </Modal>
  );
}
