// Thin line icons for the storefront, drawn inline so they need no requests
// and no icon dependency. All use currentColor and are aria-hidden: the
// control that holds them carries the accessible name.

type IconProps = { className?: string };

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

/** Speech bubble with a handset: the WhatsApp-style chat glyph. */
export function WhatsAppIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} strokeWidth={1.6} d="M3.6 20.4 4.9 16.3A8.3 8.3 0 1 1 7.7 19.1Z" />
      <path
        fill="currentColor"
        d="M9.2 7.8c.3-.3.8-.3 1 .1l.9 1.6c.2.3.1.7-.1 1l-.6.6c.5 1 1.4 1.9 2.4 2.4l.6-.6c.3-.3.7-.3 1-.1l1.6.9c.4.2.4.7.1 1l-.8.8c-.6.6-1.5.7-2.2.3-1.9-1-3.5-2.6-4.5-4.5-.4-.7-.3-1.6.3-2.2Z"
      />
    </svg>
  );
}

export function InstagramIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <rect {...line} x="3.5" y="3.5" width="17" height="17" rx="4.5" />
      <circle {...line} cx="12" cy="12" r="3.8" />
      <circle cx="17.1" cy="6.9" r="1" fill="currentColor" />
    </svg>
  );
}

export function FacebookIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M14.5 21v-7.5h2.6l.4-3h-3V8.6c0-.9.3-1.5 1.6-1.5h1.5V4.4c-.3 0-1.2-.1-2.2-.1-2.2 0-3.6 1.3-3.6 3.8v2.4H9.3v3h2.5V21" />
    </svg>
  );
}

/** Thin-line musical note, after the TikTok glyph. */
export function TikTokIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M14 3.5v11.3a3.7 3.7 0 1 1-3.7-3.7" />
      <path {...line} d="M14 3.5c.4 2.6 2.2 4.4 4.8 4.6" />
    </svg>
  );
}

export function MenuIcon({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M3.5 7h17M3.5 12h17M3.5 17h11" />
    </svg>
  );
}

export function CloseIcon({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M5.5 5.5l13 13M18.5 5.5l-13 13" />
    </svg>
  );
}

export function ArrowRightIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M4 12h15M14 7l5 5-5 5" />
    </svg>
  );
}

export function ChevronLeftIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M15 5l-7 7 7 7" />
    </svg>
  );
}

export function ChevronRightIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M9 5l7 7-7 7" />
    </svg>
  );
}

export function ChevronDownIcon({ className = "h-4 w-4" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M6 9l6 6 6-6" />
    </svg>
  );
}

export function ExpandIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" />
    </svg>
  );
}

/** Premium quality: a faceted gem outline. */
export function QualityIcon({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M6.5 4.5h11l3.5 5-9 10-9-10z M3 9.5h18 M9.5 4.5 8 9.5l4 10 4-10-1.5-5" />
    </svg>
  );
}

/** Visit our store: a shopfront with an awning. */
export function StoreIcon({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M4 10.5V20h16v-9.5 M3 5h18l-1 5.5H4z M9.5 20v-5.5h5V20" />
    </svg>
  );
}

/** Enquire: an empty speech bubble. */
export function ChatIcon({ className = "h-6 w-6" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M4 5.5h16v10H10l-4.5 3.5v-3.5H4z M8 9.5h8 M8 12.5h5" />
    </svg>
  );
}

export function MapPinIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <path {...line} d="M12 21s-6.5-6-6.5-11a6.5 6.5 0 0 1 13 0c0 5-6.5 11-6.5 11z" />
      <circle {...line} cx="12" cy="10" r="2.3" />
    </svg>
  );
}

export function ClockIcon({ className = "h-5 w-5" }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      <circle {...line} cx="12" cy="12" r="8.5" />
      <path {...line} d="M12 7.5V12l3 2" />
    </svg>
  );
}
