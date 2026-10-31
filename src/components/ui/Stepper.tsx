'use client';

interface StepperProps {
  value: number;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  testId?: string;
}

export function Stepper({ value, onChange, min = 1, max = 9999, testId }: StepperProps) {
  return (
    <div className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50" data-testid={testId}>
      <button
        type="button"
        className="w-10 h-10 flex items-center justify-center text-slate-600 hover:bg-slate-100 rounded-l-full"
        onClick={() => onChange(Math.max(min, value - 1))}
        aria-label="Decrease"
      >
        −
      </button>
      <span className="w-10 text-center font-semibold text-slate-900">{value}</span>
      <button
        type="button"
        className="w-10 h-10 flex items-center justify-center text-brand-olive hover:bg-brand-olive-50 rounded-r-full"
        onClick={() => onChange(Math.min(max, value + 1))}
        aria-label="Increase"
      >
        +
      </button>
    </div>
  );
}
