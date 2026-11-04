import type { Line } from '@renfe/shared';

export function LineChip({ line, small }: { line: Line; small?: boolean }) {
  return (
    <span
      className={`line-chip${small ? ' small' : ''}`}
      style={{ background: `#${line.color}`, color: `#${line.textColor}` }}
    >
      {line.name}
    </span>
  );
}
