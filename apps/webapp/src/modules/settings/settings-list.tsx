import type { ReactNode } from "react";

/** Settings as rows under a hairline, with one between each; the section's rule closes the list. */
export function SettingsList({ children }: { children: ReactNode }) {
  return (
    <ul className="flex flex-col divide-y divide-separator border-t border-separator">
      {children}
    </ul>
  );
}

/**
 * One setting: what it is on the left, its current state and what can be done with it on the
 * right. `children` opens below the row, as an inline editor does.
 */
export function SettingsRow({
  label,
  description,
  value,
  actions,
  children,
}: {
  label: ReactNode;
  description?: ReactNode;
  value?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
}) {
  return (
    <li className="flex flex-col gap-3 py-3">
      <div className="flex items-center gap-4">
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-sm font-medium">{label}</span>
          {description ? (
            <span className="text-xs text-muted">{description}</span>
          ) : null}
        </div>
        {value ? (
          <div className="max-w-1/2 min-w-0 truncate text-right text-sm text-muted">
            {value}
          </div>
        ) : null}
        {actions ? (
          <div className="flex shrink-0 items-center gap-2">{actions}</div>
        ) : null}
      </div>
      {children}
    </li>
  );
}
