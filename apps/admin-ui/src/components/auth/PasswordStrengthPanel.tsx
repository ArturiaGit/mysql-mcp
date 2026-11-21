import { evaluatePasswordStrength } from '@/api/schemas/auth.schema';
import { Icon } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

export interface PasswordStrengthPanelProps {
  id: string;
  password: string;
}

export function PasswordStrengthPanel({ id, password }: PasswordStrengthPanelProps) {
  const result = evaluatePasswordStrength(password);

  const rules = [
    { key: 'len', met: result.lengthValid, label: '8~64 位字符（推荐 ≥ 12 位）' },
    { key: 'upper', met: result.hasUpper, label: '包含大写字母 (A-Z)' },
    { key: 'lower', met: result.hasLower, label: '包含小写字母 (a-z)' },
    { key: 'digit', met: result.hasDigit, label: '包含数字 (0-9)' },
    { key: 'special', met: result.hasSpecial, label: '包含特殊符号 (!@#$…)' },
  ];

  const toneClass =
    result.label === '强（推荐）'
      ? 'text-safe'
      : result.label === '中（合规）'
        ? 'text-primary'
        : result.label === '弱'
          ? 'text-danger'
          : 'text-fg-subtle';

  return (
    <div
      id={id}
      className="rounded-md border border-border-line bg-bg-surface/60 px-3 py-2 text-[11px]"
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-fg-muted">强密码复杂度要求</span>
        <span className={cn('font-mono font-medium tabular-nums', toneClass)}>
          {result.label}
        </span>
      </div>
      <div className="mt-1.5 grid grid-cols-5 gap-1" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((step) => (
          <span
            key={step}
            className={cn(
              'h-1 rounded-sm transition-colors duration-150',
              result.score >= step
                ? result.isValid
                  ? result.recommendedLength
                    ? 'bg-safe'
                    : 'bg-primary'
                  : 'bg-warning'
                : 'bg-border-line',
            )}
          />
        ))}
      </div>
      <ul className="mt-2 grid grid-cols-1 gap-1 sm:grid-cols-2">
        {rules.map((rule) => (
          <li
            key={rule.key}
            className={cn(
              'flex items-center gap-1.5',
              rule.met ? 'text-safe' : 'text-fg-muted',
            )}
          >
            <Icon
              name={rule.met ? 'check-circle' : 'shield'}
              className={cn('size-3 shrink-0', rule.met ? 'text-safe' : 'text-fg-subtle')}
            />
            <span>{rule.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
