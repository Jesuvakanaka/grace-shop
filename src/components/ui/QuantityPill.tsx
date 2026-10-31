interface QuantityPillProps {
  quantity: number;
  lowThreshold?: number;
}

export function QuantityPill({ quantity, lowThreshold = 5 }: QuantityPillProps) {
  let variant = 'badge-success';
  if (quantity <= 0) variant = 'badge-danger';
  else if (quantity <= lowThreshold) variant = 'badge-warning';

  return <span className={`badge ${variant}`}>{quantity}</span>;
}
