/** A damped spring, as in most animation libraries. Higher stiffness is faster; lower damping bouncier. */
export interface Spring {
  readonly stiffness: number;
  readonly damping: number;
  readonly mass?: number;
}

/** How close to the end the spring has to stay before the animation stops. */
const REST = 0.001;
const SAMPLES = 80;

/** Progress (0 to 1, past 1 when it overshoots) of a spring released from rest, `t` seconds in. */
const position = ({ stiffness, damping, mass = 1 }: Spring, t: number): number => {
  const omega = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta >= 1) return 1 - Math.exp(-omega * t) * (1 + omega * t);
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return (
    1 -
    Math.exp(-zeta * omega * t) *
      (Math.cos(damped * t) + ((zeta * omega) / damped) * Math.sin(damped * t))
  );
};

/**
 * The spring as a Web Animations / CSS timing: a `linear()` easing sampled from it and the time it
 * takes to settle. Run it with `element.animate(keyframes, springTiming(spring))`, so the browser
 * plays it off the main thread.
 */
export const springTiming = (spring: Spring): { easing: string; duration: number } => {
  const { stiffness, damping, mass = 1 } = spring;
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  const omega = Math.sqrt(stiffness / mass);
  // The amplitude envelope falls below REST by then (critically damped springs need a little longer).
  const settle = -Math.log(REST) / (Math.min(zeta, 1) * omega) + (zeta >= 1 ? 4 / omega : 0);
  const points = Array.from({ length: SAMPLES + 1 }, (_, i) =>
    i === SAMPLES ? 1 : position(spring, (settle * i) / SAMPLES),
  );
  return {
    easing: `linear(${points.map((p) => Number(p.toFixed(4))).join(", ")})`,
    duration: Math.round(settle * 1000),
  };
};
