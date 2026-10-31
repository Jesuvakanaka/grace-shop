import type { ReactNode } from "react";
import { cn } from "./cn";
import { ChatIcon, QualityIcon, StoreIcon } from "./icons";

export type TrustItem = { icon: ReactNode; title: string; text?: string };

export const DEFAULT_TRUST_ITEMS: TrustItem[] = [
  { icon: <QualityIcon />, title: "Premium quality", text: "Pieces chosen for cut, cloth and finish." },
  { icon: <StoreIcon />, title: "Visit our store", text: "Try it on and find your fit in person." },
  { icon: <ChatIcon />, title: "Enquire on WhatsApp", text: "Ask about sizes, colours and prices." },
];

/** "Premium Quality · Visit Our Store · Enquire on WhatsApp" with thin line icons. */
export function TrustStrip({ items = DEFAULT_TRUST_ITEMS, className }: { items?: TrustItem[]; className?: string }) {
  return (
    <section aria-label="Why shop with us" className={cn("border-y border-brand-ink/10! bg-brand-cream-100", className)}>
      <ul className="mx-auto grid max-w-[1200px] divide-y divide-brand-ink/10! px-4 sm:grid-cols-3 sm:divide-x sm:divide-y-0 sm:px-6 lg:px-8">
        {items.map((item) => (
          <li key={item.title} className="flex items-start gap-4 py-6 sm:flex-col sm:items-center sm:px-6 sm:py-10 sm:text-center">
            <span className="mt-0.5 shrink-0 text-brand-olive-700">{item.icon}</span>
            <span className="flex flex-col gap-1.5">
              <span className="sf-label-lg text-brand-ink">{item.title}</span>
              {item.text ? <span className="text-sm leading-relaxed text-brand-ink-soft">{item.text}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
