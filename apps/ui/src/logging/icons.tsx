/** Icons of the logging overlay, and its sparkles, which the pill's star shares. */

/** A four-pointed star centred at (x, y), `r` from its centre to each point. */
const star = (x: number, y: number, r: number) => {
  const a = r * 0.16;
  return `M${x} ${y - r}Q${x + a} ${y - a} ${x + r} ${y}Q${x + a} ${y + a} ${x} ${y + r}Q${x - a} ${y + a} ${x - r} ${y}Q${x - a} ${y - a} ${x} ${y - r}Z`;
};
const sparkles = [star(6.25, 9.25, 5.75), star(12.5, 3.25, 2.5), star(12.75, 12.75, 1.75)].join("");

/** The session's summary, on the pill's star. */
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
