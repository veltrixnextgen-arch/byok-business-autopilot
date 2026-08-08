import { cx } from "../ui";
import { NetworkIllustration } from "./NetworkIllustration";

// The reference's hero (measured live, 2026-08-08 — see the PR body for
// the cross-origin-iframe caveat on exact values): a framed square panel
// containing a photographic figure with a dense field of small unlabeled
// work-category nodes around them, and — reusing the SAME visual language
// as our own NetworkIllustration's "arrived" state — a smaller labeled
// team-ring sitting at the bottom of the panel. Genuinely reuses
// NetworkIllustration (stage 2) for that ring rather than re-deriving its
// math; this file only adds what NetworkIllustration doesn't already do:
// the frame, the photo, and the dense field.
//
// Labels are the reference's own — a wide field of plausible work
// categories, not a claim about our product's actual team structure (that
// claim stays scoped to NetworkIllustration's own Money/Clients/Marketing/
// Operations ring, our real taxonomy, unchanged here).
const FIELD_NODES = [
  { label: "Customer Support", angle: 205, radius: 148, size: 5 },
  { label: "Research", angle: 172, radius: 118, size: 4.5 },
  { label: "Marketing", angle: 135, radius: 152, size: 5 },
  { label: "Compliance", angle: 100, radius: 126, size: 4 },
  { label: "Delivery", angle: 68, radius: 146, size: 5 },
  { label: "Sales", angle: 34, radius: 154, size: 5.5 },
  { label: "Content", angle: 4, radius: 132, size: 4.5 },
  { label: "Finance", angle: -28, radius: 150, size: 5 },
  { label: "Operations", angle: -65, radius: 128, size: 4.5 },
  { label: "Scheduling", angle: -110, radius: 142, size: 4 },
] as const;

// Unlabeled dust — denser than NetworkIllustration's own DUST array, since
// this panel's whole job is to read as "a lot of scattered work," not a
// single settled network.
const FIELD_DUST = [
  { angle: 12, radius: 60, size: 2 },
  { angle: 44, radius: 92, size: 2.5 },
  { angle: 80, radius: 70, size: 2 },
  { angle: 112, radius: 100, size: 2.5 },
  { angle: 150, radius: 82, size: 2 },
  { angle: 184, radius: 106, size: 3 },
  { angle: 216, radius: 76, size: 2 },
  { angle: 248, radius: 96, size: 2.5 },
  { angle: 280, radius: 66, size: 2 },
  { angle: 312, radius: 110, size: 2.5 },
  { angle: 340, radius: 86, size: 2 },
  { angle: 8, radius: 190, size: 2 },
  { angle: 70, radius: 195, size: 2.5 },
  { angle: 140, radius: 200, size: 2 },
] as const;

const CENTER = 200;

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function polar(angle: number, radius: number) {
  const rad = (angle * Math.PI) / 180;
  return { x: round2(CENTER + radius * Math.cos(rad)), y: round2(160 - radius * Math.sin(rad) * 0.6) };
}

function hexPoints(cx: number, cy: number, r: number): string {
  return Array.from({ length: 6 }, (_, i) => {
    const rad = (Math.PI / 3) * i - Math.PI / 6;
    return `${round2(cx + r * Math.cos(rad))},${round2(cy + r * Math.sin(rad))}`;
  }).join(" ");
}

export function HeroPanel({ className }: { className?: string }) {
  return (
    <figure className={cx("relative mx-auto aspect-square w-full max-w-[520px] overflow-hidden rounded-[24px] border border-white/10 bg-bg", className)}>
      <div aria-hidden="true" className="rw-kenburns pointer-events-none absolute inset-0 bg-gradient-to-b from-accent-strong/12 via-transparent to-transparent blur-2xl" />

      {/* Dense work-category field — behind the figure, in front of the panel bg. */}
      <svg viewBox="0 0 400 400" className="absolute inset-0 h-full w-full" aria-hidden="true">
        <g className="rw-orbit" style={{ transformOrigin: "200px 160px" }}>
          {FIELD_DUST.map((d, i) => {
            const { x, y } = polar(d.angle, d.radius);
            return (
              <circle
                key={i}
                cx={x}
                cy={y}
                r={d.size}
                className="rw-breathe fill-white/20"
                style={{ animationDuration: `${4 + (i % 5)}s`, animationDelay: `${i * 0.25}s`, transformOrigin: `${x}px ${y}px` }}
              />
            );
          })}
        </g>
        {FIELD_NODES.map((node, i) => {
          const { x, y } = polar(node.angle, node.radius);
          const cx0 = CENTER;
          const cy0 = 160;
          return (
            <g key={node.label} className="rw-breathe" style={{ animationDuration: `${6.5 + (i % 4)}s`, animationDelay: `${i * 0.2}s`, transformOrigin: `${x}px ${y}px` }}>
              <line x1={cx0} y1={cy0} x2={x} y2={y} className="stroke-white/[0.08]" strokeWidth={1} />
              <polygon points={hexPoints(x, y, node.size)} className="fill-accent/40 stroke-accent/60" strokeWidth={0.75} />
              <text
                x={x}
                y={y + (y > cy0 ? 14 : -9)}
                textAnchor="middle"
                className="fill-text-muted/90 text-[7.5px] uppercase tracking-[0.08em]"
                style={{ fontFamily: "var(--font-mono)" }}
              >
                {node.label}
              </text>
            </g>
          );
        })}
      </svg>

      {/* Photographic figure — swap-in file the user commits to
          public/hero-figure.webp; a soft mask fades it into the panel
          rather than a hard rectangular edge, so a plain cutout composites
          the same way the reference's own figure does. No layout shift if
          the file is absent: the CSS gradient behind it already fills the
          space. */}
      <img
        src="/hero-figure.webp"
        alt=""
        aria-hidden="true"
        width={1200}
        height={1200}
        className="absolute left-1/2 top-[6%] h-[62%] w-[46%] -translate-x-1/2 object-cover object-top"
        style={{
          maskImage: "linear-gradient(to bottom, black 55%, transparent 96%), radial-gradient(ellipse 60% 90% at center, black 60%, transparent 100%)",
          maskComposite: "intersect",
          WebkitMaskImage: "linear-gradient(to bottom, black 55%, transparent 96%), radial-gradient(ellipse 60% 90% at center, black 60%, transparent 100%)",
          WebkitMaskComposite: "source-in",
        }}
        onError={(e) => {
          (e.currentTarget as HTMLImageElement).style.display = "none";
        }}
      />

      {/* Team ring — genuinely reused, not re-derived. Sized via this
          wrapper's own width rather than passing width classes into
          NetworkIllustration itself: its own root already carries
          `w-full`, and two width utilities on the same element don't
          reliably resolve by source order, so constraining the parent is
          the robust way to shrink it. */}
      <div className="absolute inset-x-0 bottom-[3%] mx-auto w-[50%]">
        <NetworkIllustration stage={2} />
      </div>

      <figcaption className="absolute inset-x-0 bottom-4 text-center font-mono text-[10px] uppercase tracking-[0.2em] text-text-muted">
        Runwisely finds the work
      </figcaption>
    </figure>
  );
}
