// VYRA wordmark and mark as inline SVG (same paths as public/brand/*.svg), so
// they can take any brand colour through currentColor: ink in the header,
// cream in the footer. The wordmark is always these paths, never typed text.

type WordmarkProps = {
  /** Show "WEAR DIFFERENT" under the letters. Only at 200px wide and up. */
  tagline?: boolean;
  className?: string;
  /** Accessible name. Pass "" when a parent link already names it. */
  title?: string;
};

const LETTERS = (
  <g fill="currentColor" fillRule="evenodd">
    <path d="M0 0 H13 L42 82 L71 0 H84 L48.5 100 H35.5 Z" />
    <path transform="translate(130 0)" d="M0 0 H13 L40 43.5 L67 0 H80 L46.5 54 V100 H33.5 V54 Z" />
    <path
      transform="translate(256 0)"
      d="M0 0 H36 A28 28 0 0 1 41.5 55.4 L66 100 H51 L27.5 56 H13 V100 H0 Z M13 13 V43 H36 A15 15 0 0 0 36 13 Z"
    />
    <path
      transform="translate(368 0)"
      d="M35.5 0 H48.5 L84 100 H71 L62.3 75.5 H21.7 L13 100 H0 Z M26.1 63.5 H58 L42 18.3 Z"
    />
  </g>
);

// "WEAR DIFFERENT", stroked single-line capitals from vyra-wordmark.svg.
const TAGLINE: Array<[number, string]> = [
  [1.3, "M0 0 L0.24 1 L0.48 0.18 L0.72 1 L0.96 0"],
  [42.58, "M0.52 0 H0 V1 H0.52 M0 0.5 H0.46"],
  [75.05, "M0 1 L0.39 0 L0.78 1 M0.14 0.66 H0.64"],
  [112.73, "M0 1 V0 H0.3 A0.25 0.25 0 0 1 0.3 0.5 H0 M0.3 0.5 L0.58 1"],
  [178.88, "M0 0 V1 H0.28 A0.5 0.5 0 0 0 0.28 0 Z"],
  [216.56, "M0 0 V1"],
  [238.64, "M0.5 0 H0 V1 M0 0.5 H0.44"],
  [270.72, "M0.5 0 H0 V1 M0 0.5 H0.44"],
  [302.79, "M0.52 0 H0 V1 H0.52 M0 0.5 H0.46"],
  [335.27, "M0 1 V0 H0.3 A0.25 0.25 0 0 1 0.3 0.5 H0 M0.3 0.5 L0.58 1"],
  [369.35, "M0.52 0 H0 V1 H0.52 M0 0.5 H0.46"],
  [401.82, "M0 1 V0 L0.72 1 V0"],
  [438.3, "M0 0 H0.62 M0.31 0 V1"],
];

export function Wordmark({ tagline = false, className, title = "VYRA" }: WordmarkProps) {
  const viewBox = tagline ? "-2 -2 456 162" : "-2 -2 456 104";
  const labelled = title !== "";
  return (
    <svg
      viewBox={viewBox}
      className={className}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      {LETTERS}
      {tagline ? (
        <g fill="none" stroke="currentColor" strokeLinejoin="miter" strokeMiterlimit={10}>
          {TAGLINE.map(([x, d]) => (
            <path key={x} transform={`translate(${x} 138) scale(20)`} d={d} strokeWidth={0.13} />
          ))}
        </g>
      ) : null}
    </svg>
  );
}

type MarkProps = {
  /** "colour" = olive + lime arms (cream/white backgrounds); "mono" = currentColor. */
  tone?: "colour" | "mono";
  className?: string;
  title?: string;
};

export function Mark({ tone = "colour", className, title = "" }: MarkProps) {
  const labelled = title !== "";
  return (
    <svg
      viewBox="0 0 512 512"
      className={className}
      role={labelled ? "img" : undefined}
      aria-label={labelled ? title : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
    >
      {labelled ? <title>{title}</title> : null}
      <g transform="translate(0 -16)">
        {tone === "colour" ? (
          <>
            <path fill="#5F7A1F" d="M64 96 H172 L310 349 L256 448 Z" />
            <path fill="#9BB21E" d="M448 96 H340 L202 349 L256 448 Z" />
            <path fill="#4A6018" d="M256 250 L310 349 L256 448 L202 349 Z" />
          </>
        ) : (
          <g fill="currentColor">
            <path d="M64 96 H172 L248 235.4 L194 334.4 Z" />
            <path d="M448 96 H340 L202 349 L256 448 Z" />
          </g>
        )}
      </g>
    </svg>
  );
}
