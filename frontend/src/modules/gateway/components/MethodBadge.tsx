import type { HttpMethod } from '@/types/gateway.types';

// One colour a method everywhere it is shown, so a list can be read by colour.
const COLORS: Record<HttpMethod, string> = {
  GET: '#17b26a',
  POST: '#ef6820',
  PUT: '#2e90fa',
  PATCH: '#ee46bc',
  DELETE: '#f04438',
  HEAD: '#0e9384',
  OPTIONS: '#7a5af8',
};

// The long names, cut to fit a narrow column.
const SHORT: Partial<Record<HttpMethod, string>> = { DELETE: 'DEL', PATCH: 'PAT', OPTIONS: 'OPT' };

interface MethodBadgeProps {
  /** The methods a work takes; none means any. */
  methods: readonly HttpMethod[];
  className?: string;
}

/** A work's method as a short coloured word: the first one, with a "+" when there are more. */
export function MethodBadge({ methods, className = '' }: MethodBadgeProps) {
  const [first] = methods;

  return (
    <span
      className={`inline-block w-9 shrink-0 text-[11px] leading-none font-bold tracking-tight ${first ? '' : 'text-subtle'} ${className}`}
      style={first ? { color: COLORS[first] } : undefined}
      title={methods.length > 0 ? methods.join(', ') : undefined}
    >
      {first ? (SHORT[first] ?? first) : 'ANY'}
      {methods.length > 1 && '+'}
    </span>
  );
}
