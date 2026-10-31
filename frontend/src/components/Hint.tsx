import { Tooltip } from 'antd';
import { CircleHelp } from 'lucide-react';

interface HintProps {
  text: string;
}

/**
 * A small "?" that explains what is beside it when pointed at. The
 * explanation is there for whoever wants it, and out of the way otherwise.
 */
export function Hint({ text }: HintProps) {
  return (
    <Tooltip title={text}>
      <span
        tabIndex={0}
        role="img"
        aria-label={text}
        className="inline-flex shrink-0 cursor-help text-subtle outline-none hover:text-body focus-visible:text-brand"
      >
        <CircleHelp size={14} />
      </span>
    </Tooltip>
  );
}
