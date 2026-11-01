// ZP-500: line icons for the flip feed (from the approved design). aria-hidden:
// the control that holds an icon carries the accessible name.
type IconProps = { className?: string };

const line = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function Icon({ className = "h-6 w-6", children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

export const MenuLinesIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M4 7h16M4 12h16M4 17h10" />
  </Icon>
);

export const PinIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M12 21s-7-6.2-7-11.5a7 7 0 0 1 14 0C19 14.8 12 21 12 21z" />
    <circle {...line} cx="12" cy="9.5" r="2.5" />
  </Icon>
);

export const EnquireIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M20 11.5a8 8 0 0 1-11.6 7.1L4 20l1.4-4.2A8 8 0 1 1 20 11.5z" />
    <path {...line} d="M9 10.5h6M9 13.5h4" />
  </Icon>
);

export const ShareIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M12 3v12M7 8l5-5 5 5M5 13v6a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-6" />
  </Icon>
);

export const DetailsIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M4 6h16M4 12h16M4 18h9" />
  </Icon>
);

export const EyeIcon = ({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle {...line} cx="12" cy="12" r="3" />
  </Icon>
);

export const ArrowIcon =({ className }: IconProps) => (
  <Icon className={className}>
    <path {...line} d="M5 12h14M13 6l6 6-6 6" />
  </Icon>
);

export const ChevronIcon = ({ className, direction }: IconProps & { direction: "up" | "down" | "left" | "right" }) => {
  const d = { up: "M6 15l6-6 6 6", down: "M6 9l6 6 6-6", left: "M15 5l-7 7 7 7", right: "M9 5l7 7-7 7" }[direction];
  return (
    <Icon className={className}>
      <path {...line} d={d} />
    </Icon>
  );
};
