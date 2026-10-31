interface HeroCardProps {
  label: string;
  value: string;
  sublabel?: string;
  testId?: string;
}

export function HeroCard({ label, value, sublabel, testId }: HeroCardProps) {
  return (
    <div className="rounded-2xl bg-brand-olive text-white p-6 shadow-lg shadow-brand-olive/20" data-testid={testId}>
      <div className="h-1 w-10 rounded-full bg-brand-lime mb-3" aria-hidden="true" />
      <div className="text-xs font-medium text-white uppercase tracking-[0.16em]">{label}</div>
      <div className="text-4xl font-bold mt-2">{value}</div>
      {sublabel && <div className="text-sm text-white mt-2">{sublabel}</div>}
    </div>
  );
}
