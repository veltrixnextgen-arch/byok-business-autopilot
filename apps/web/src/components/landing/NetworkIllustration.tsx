import { cx } from "../ui";

// Hand-authored SVG, animated with CSS transform/opacity only — not a
// port of the reference's own hero graphic. Confirmed by reading the
// reference's bundle (docs/design/reference-emergent.md): it's a plain
// canvas 2D requestAnimationFrame loop, not a physics simulation — no
// d3-force or similar dependency involved on either side. This reproduces
// the same design with CSS instead of a JS draw loop — a center node,
// orbiting dust (rw-orbit, unlabeled so rotation never has to fight
// upside-down text), and four labeled team nodes each breathing on its
// own, slightly offset duration (rw-breathe) so nothing moves in
// lockstep. "Alive" via varied CSS timing, composited off the main
// thread.
//
// `stage` controls how much of the graphic has "arrived" (used by
// ScrollSequence to evolve the same illustration across its six steps):
// 0 = idea only, 1 = + task dust, 2 = + the four real teams (full).
// Hero always renders stage 2 — it's a promise of the end state, not a
// narrative.
export type IllustrationStage = 0 | 1 | 2;

const CENTER = 200;

const TEAM_NODES = [
  { tone: "money", label: "Money", angle: -55, radius: 148, duration: 6.2 },
  { tone: "clients", label: "Clients", angle: 35, radius: 152, duration: 7.1 },
  { tone: "marketing", label: "Marketing", angle: 145, radius: 150, duration: 6.6 },
  { tone: "operations", label: "Operations", angle: 235, radius: 146, duration: 7.6 },
] as const;

const DUST = [
  { angle: 10, radius: 92, size: 2.5, duration: 4.4 },
  { angle: 55, radius: 78, size: 2, duration: 5.2 },
  { angle: 100, radius: 96, size: 3, duration: 4.8 },
  { angle: 150, radius: 84, size: 2, duration: 5.6 },
  { angle: 190, radius: 100, size: 2.5, duration: 4.2 },
  { angle: 230, radius: 80, size: 2, duration: 5.9 },
  { angle: 275, radius: 94, size: 3, duration: 4.6 },
  { angle: 320, radius: 86, size: 2, duration: 5.1 },
] as const;

const TONE_FILL: Record<(typeof TEAM_NODES)[number]["tone"], string> = {
  money: "fill-money",
  clients: "fill-clients",
  marketing: "fill-marketing",
  operations: "fill-operations",
};

// Math.cos/Math.sin aren't guaranteed bit-identical across JS engines the
// way +/-/*// are — SSR (Node's V8) and hydration (the browser's V8) can
// disagree in the far decimal places of a transcendental function's
// result, which React then reports as a hydration mismatch on the
// resulting cx/cy attributes. Rounding well above where that noise lives
// (2 decimal places, against ~14 decimal places of actual discrepancy)
// guarantees the server and client serialize the exact same string.
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: round2(CENTER + radius * Math.cos(rad)), y: round2(CENTER + radius * Math.sin(rad)) };
}

export function NetworkIllustration({ stage, className }: { stage: IllustrationStage; className?: string }) {
  return (
    <div className={cx("relative mx-auto aspect-square w-full max-w-[420px]", className)}>
      <div
        aria-hidden="true"
        className="rw-kenburns pointer-events-none absolute inset-0 rounded-full bg-gradient-to-br from-accent-strong/25 via-accent/10 to-transparent blur-2xl"
      />
      <svg viewBox="0 0 400 400" className="relative" aria-hidden="true">
        <g className={cx("rw-orbit transition-opacity duration-landing-entrance ease-landing", stage < 1 && "opacity-0")} style={{ transformOrigin: "200px 200px" }}>
          {DUST.map((dot, i) => {
            const { x, y } = polar(dot.angle, dot.radius);
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={dot.size}
                className="rw-breathe fill-white/25"
                style={{ animationDuration: `${dot.duration}s`, animationDelay: `${i * 0.3}s`, transformOrigin: `${x}px ${y}px` }}
              />
            );
          })}
        </g>

        <g className={cx("transition-opacity duration-landing-entrance ease-landing", stage < 2 && "opacity-0")}>
          {TEAM_NODES.map((node) => {
            const { x, y } = polar(node.angle, node.radius);
            return (
              <g key={node.label}>
                <line x1={CENTER} y1={CENTER} x2={x} y2={y} className="stroke-white/10" strokeWidth={1} />
                <circle
                  cx={x}
                  cy={y}
                  r={6}
                  className={cx("rw-breathe", TONE_FILL[node.tone])}
                  style={{ animationDuration: `${node.duration}s`, transformOrigin: `${x}px ${y}px` }}
                />
                <text
                  x={x}
                  y={y + (y > CENTER ? 18 : -12)}
                  textAnchor="middle"
                  className={cx("text-[11px] uppercase tracking-[0.1em]", TONE_FILL[node.tone])}
                  style={{ fontFamily: "var(--font-mono)" }}
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>

        <circle cx={CENTER} cy={CENTER} r={27} className="rw-breathe fill-accent-strong" style={{ transformOrigin: "200px 200px" }} />
        <circle cx={CENTER} cy={CENTER} r={27} fill="none" className="stroke-accent-strong/40" strokeWidth={2} />
        <text x={CENTER} y={CENTER + 4} textAnchor="middle" className="fill-[#120c22] text-[10px] font-semibold uppercase tracking-[0.1em]" style={{ fontFamily: "var(--font-mono)" }}>
          Idea
        </text>
      </svg>
    </div>
  );
}
