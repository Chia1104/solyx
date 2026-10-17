/** The tray icon's emblem: the ink above the horizon is signed, the dashed arc below is drafted. */
export function Logo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 18 18" aria-hidden="true" className={className}>
      <path d="M3 9A6 6 0 0 1 15 9Z" fill="var(--ink)" />
      <line
        x1="1.75"
        y1="9"
        x2="16.25"
        y2="9"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
      />
      <path
        d="M3 9A6 6 0 0 0 15 9"
        fill="none"
        stroke="var(--graphite)"
        strokeWidth="1.25"
        strokeDasharray="2.1 1.67"
        strokeDashoffset="-1.2"
      />
    </svg>
  );
}
