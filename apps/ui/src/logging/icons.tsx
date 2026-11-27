/** Icons of the logging overlay, and its sparkles, which the pill's star shares. */

const stroke = {
  width: 16,
  height: 16,
  viewBox: "0 0 16 16",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round",
  strokeLinejoin: "round",
  "aria-hidden": true,
} as const;

/** A four-pointed star centred at (x, y), `r` from its centre to each point. */
const star = (x: number, y: number, r: number) => {
  const a = r * 0.16;
  return `M${x} ${y - r}Q${x + a} ${y - a} ${x + r} ${y}Q${x + a} ${y + a} ${x} ${y + r}Q${x - a} ${y + a} ${x - r} ${y}Q${x - a} ${y - a} ${x} ${y - r}Z`;
};
const sparkles = [star(6.25, 9.25, 5.75), star(12.5, 3.25, 2.5), star(12.75, 12.75, 1.75)].join("");

/** The log assistant: on the pill's star and as the avatar of the assistant's messages. */
export const SparklesIcon = ({ size = 16 }: { readonly size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden>
    <path d={sparkles} fill="currentColor" />
  </svg>
);

/** Kladd's app icon: the white notebook on its violet tile (logo/variants/kladd-symbol-app-icon.svg). */
export const KladdIcon = ({ size }: { readonly size: number }) => (
  <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden>
    <rect width="256" height="256" rx="57.6" fill="#5B3DF5" />
    <g transform="translate(33.92 33.92) scale(0.735)" fill="#fff">
      <path d="M56 20 H72 V236 H56 A12 12 0 0 1 44 224 V32 A12 12 0 0 1 56 20 Z" />
      <path
        fillRule="evenodd"
        d="M88 20 H188 A24 24 0 0 1 212 44 V212 A24 24 0 0 1 188 236 H88 Z M105 108 V90 A9 9 0 0 1 114 81 H132 A9 9 0 0 1 132 99 H123 V108 A9 9 0 0 1 105 108 Z M195 108 V90 A9 9 0 0 0 186 81 H168 A9 9 0 0 0 168 99 H177 V108 A9 9 0 0 0 195 108 Z M195 148 V166 A9 9 0 0 1 186 175 H168 A9 9 0 0 1 168 157 H177 V148 A9 9 0 0 1 195 148 Z M105 148 V166 A9 9 0 0 0 114 175 H132 A9 9 0 0 0 132 157 H123 V148 A9 9 0 0 0 105 148 Z"
      />
    </g>
  </svg>
);

/** A framed landscape: attach one of the session's screenshots. */
export const ImageIcon = () => (
  <svg {...stroke}>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" />
    <path d="m2.75 11.25 3.25-3.25 2.5 2.5 1.5-1.5 3.25 3.25" />
    <circle cx="10.25" cy="5.75" r="1" fill="currentColor" stroke="none" />
  </svg>
);

/** Angle brackets: insert a code snippet. */
export const CodeIcon = () => (
  <svg {...stroke}>
    <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5" />
  </svg>
);

/** A microphone: dictate the message. */
export const MicIcon = () => (
  <svg {...stroke}>
    <rect x="6" y="1.75" width="4" height="7.5" rx="2" />
    <path d="M3.75 7.5a4.25 4.25 0 0 0 8.5 0M8 11.75v2.5" />
  </svg>
);

/** Send the message. */
export const ArrowUpIcon = () => (
  <svg {...stroke}>
    <path d="M8 13V3M3.75 7.25 8 3l4.25 4.25" />
  </svg>
);
