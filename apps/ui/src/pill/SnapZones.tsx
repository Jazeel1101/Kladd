import { attractRange } from "./notchShape";

/**
 * SnapZones: the snap zones of the left, right and bottom edges, tinted while the pill is dragged.
 * Let go with the pill reaching into one and it docks on that edge. The same tint everywhere,
 * whichever zone the pill is in. A spread shadow around the rounded inside fills the band evenly,
 * corners included; the inside runs off the top, which has no zone.
 */
export const SnapZones = () => (
  <div className="pointer-events-none fixed inset-0 overflow-hidden">
    <div
      className="absolute rounded-2xl shadow-[0_0_0_9999px_rgb(59_130_246/0.22)]"
      style={{ inset: `-1rem ${attractRange}px ${attractRange}px` }}
    />
  </div>
);
