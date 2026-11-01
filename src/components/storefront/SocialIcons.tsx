import type { ReactNode } from "react";
import { cn } from "./cn";
import { FacebookIcon, InstagramIcon, TikTokIcon, WhatsAppIcon } from "./icons";
import type { SocialIcon, SocialLink } from "./types";

const icons: Record<SocialIcon, ReactNode> = {
  instagram: <InstagramIcon />,
  facebook: <FacebookIcon />,
  tiktok: <TikTokIcon />,
  whatsapp: <WhatsAppIcon />,
};

const tones = {
  /** On ink (footer): cream icons, lime on hover. */
  dark: "text-brand-cream ring-brand-cream/20 hover:text-brand-lime hover:ring-brand-lime",
  /** On cream (phone menu): ink icons, olive-700 on hover. */
  light: "text-brand-ink ring-brand-ink/20 hover:text-brand-olive-700 hover:ring-brand-olive-700",
};

/** Row of 44px social icon links. Each link is named by its `label`. */
export function SocialIcons({
  social,
  tone = "dark",
  className,
}: {
  social: SocialLink[];
  tone?: keyof typeof tones;
  className?: string;
}) {
  return (
    <ul className={cn("flex flex-wrap gap-2", className)}>
      {social.map((s) => (
        <li key={s.icon + s.href}>
          <a
            href={s.href}
            aria-label={s.label}
            rel={s.href.startsWith("http") ? "noopener noreferrer" : undefined}
            className={cn(
              "sf-focus inline-flex h-11 w-11 items-center justify-center rounded-[2px] ring-1 ring-inset transition-colors duration-200",
              tones[tone],
            )}
          >
            {icons[s.icon]}
          </a>
        </li>
      ))}
    </ul>
  );
}
