import type { ReactNode } from 'react';
import { Form, Switch, Typography } from 'antd';
import type { NamePath } from 'antd/es/form/interface';

const { Text } = Typography;

const FRAME = 'rounded-(--c-border-radius-lg) border border-line-soft p-(--c-spacing)';

function Heading({ title, hint, badge }: { title: string; hint: string; badge?: ReactNode }) {
  return (
    <div className="min-w-0">
      <div className="flex flex-wrap items-center gap-(--c-spacing-xs)">
        <h3 className="m-0 text-sm font-semibold">{title}</h3>
        {badge}
      </div>
      <Text type="secondary" className="block text-(length:--c-font-size-sm)!">
        {hint}
      </Text>
    </div>
  );
}

interface SectionProps {
  title: string;
  hint: string;
  /** Shown next to the title, e.g. who may change the section. */
  badge?: ReactNode;
  children?: ReactNode;
}

export function Section({ title, hint, badge, children }: SectionProps) {
  return (
    <section className={FRAME}>
      <Heading title={title} hint={hint} badge={badge} />
      {children && <div className="mt-(--c-spacing-sm)">{children}</div>}
    </section>
  );
}

interface FeatureSectionProps extends SectionProps {
  /** The boolean form field that switches the feature on. */
  toggle: NamePath;
}

/** A part of a rule that can be switched off; its settings show only while it is on. */
export function FeatureSection({ toggle, title, hint, badge, children }: FeatureSectionProps) {
  // Rendered inside the <Form>, so the watch finds its form through context.
  const isOn = Form.useWatch(toggle) as boolean | undefined;

  return (
    <section className={FRAME}>
      <div className="flex items-start justify-between gap-(--c-spacing-sm)">
        <Heading title={title} hint={hint} badge={badge} />
        <Form.Item name={toggle} valuePropName="checked" noStyle>
          <Switch aria-label={title} />
        </Form.Item>
      </div>
      {isOn && children && <div className="mt-(--c-spacing-sm)">{children}</div>}
    </section>
  );
}

interface ToggleRowProps {
  name: NamePath;
  label: string;
  hint: string;
}

/** A yes/no setting inside a section. */
export function ToggleRow({ name, label, hint }: ToggleRowProps) {
  return (
    <div className="flex items-start justify-between gap-(--c-spacing-sm)">
      <div className="min-w-0">
        <div className="font-medium">{label}</div>
        <Text type="secondary" className="text-(length:--c-font-size-sm)!">
          {hint}
        </Text>
      </div>
      <Form.Item name={name} valuePropName="checked" noStyle>
        <Switch aria-label={label} />
      </Form.Item>
    </div>
  );
}
