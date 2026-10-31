interface StatTileProps {
  label: string;
  value: string;
  icon?: string;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'info';
  testId?: string;
}

const variantStyles = {
  default: 'bg-white border-slate-200',
  success: 'bg-emerald-50 border-emerald-100',
  warning: 'bg-amber-50 border-amber-100',
  danger: 'bg-rose-50 border-rose-100',
  info: 'bg-sky-50 border-sky-100',
};

export function StatTile({ label, value, icon, variant = 'default', testId }: StatTileProps) {
  return (
    <div
      className={`rounded-xl border p-4 ${variantStyles[variant]}`}
      data-testid={testId}
    >
      {icon && <div className="text-lg mb-1">{icon}</div>}
      <div className="text-xs font-medium text-slate-500 uppercase tracking-wide">{label}</div>
      <div className="text-xl font-bold text-slate-900 mt-1">{value}</div>
    </div>
  );
}
