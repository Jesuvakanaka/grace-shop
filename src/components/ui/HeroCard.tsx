interface HeroCardProps {
  label: string;
  value: string;
  sublabel?: string;
  testId?: string;
}

export function HeroCard({ label, value, sublabel, testId }: HeroCardProps) {
  return (
    <div className="rounded-2xl bg-emerald-600 text-white p-6 shadow-lg shadow-emerald-600/20" data-testid={testId}>
      <div className="text-sm font-medium text-emerald-100 uppercase tracking-wide">{label}</div>
      <div className="text-4xl font-bold mt-2">{value}</div>
      {sublabel && <div className="text-sm text-emerald-100 mt-2">{sublabel}</div>}
    </div>
  );
}
