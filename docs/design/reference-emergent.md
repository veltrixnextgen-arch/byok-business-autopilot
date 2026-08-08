# Landing page design reference (Emergent)

**Source:** https://company-generator.preview.emergentagent.com/
**Inspected:** 2026-08-07, at 1280px and 390px, via computed-style extraction (not eyeballed) — same method as the STEP 7 fidelity pass.
**Supersedes, for the landing route only:** `docs/design/reference.html`'s landing/hero treatment. `reference.html` remains authoritative for every other screen (interview, tasks, org chart, role cards, connect, charter, dashboard, queue, digest) until each of those gets its own fidelity pass.

This is a live, client-rendered external site, not a file that can be vendored into this repo the way `reference.html` was — this document is the durable record of what was measured, so future work has something concrete to diff against instead of a URL and a memory.

## Typography

| | Value |
|---|---|
| H1 | 36px → 48px → 60px (`sm:`/`lg:` steps), weight 600 (semibold, not 700), tracking ≈ −2.5% |
| H2 | 30px → 36px → 52px, weight 600 |
| Eyebrow/mono label | 10px, `uppercase`, `tracking-[0.2em]`, neutral dim color (not per-section colored) |
| Body | 16px / 26px line-height |
| Fonts | Space Grotesk (display), Hanken Grotesk (body), Spline Sans Mono (mono) — all already our existing `--font-*` tokens, unchanged |

## Color

Base background `#0a0d16`, primary text `#ECEBF5`, CTA gradient `#7c5cff → #ff9d5c` — all pixel-identical to our existing `--color-bg`/`--color-text`/`--color-accent-strong`/`--color-cta-warm` tokens. No new palette was needed.

## Component shapes

- **Primary CTA button**: full pill (`border-radius: 999px`), dark text (`rgb(18,12,34)`) on the gradient, `padding: 0.75rem 1.35rem`, hover `translateY(-1px)` + shadow color shift toward the warm end.
- **Content cards** (`.rw-card`): flat, no backdrop-blur — `background: rgba(255,255,255,0.035)`, `border: 1px solid rgba(255,255,255,0.08)`, `border-radius: 18px` (matches our `--radius-2xl` exactly), hover: border/background brighten + `translateY(-2px)`.
- **Idea-input capsule**: a distinct treatment from content cards — `border-radius: 22px`, `background: rgba(16,20,34,0.82)`, `backdrop-filter: blur` (this one **does** blur), glow shadow, `focus-within` border brightens.
- **Tag chips**: small pill/rounded-lg badges, 11px mono uppercase, background tinted 7% in the tag's hue, border 25% opacity.
- **Background motif**: a 64×64px hairline grid (`rgba(255,255,255,0.03)` lines) behind hero-weight sections.

## Layout

Consistent `max-width: 1200px` container, `px-5`/`sm:px-8` side padding, `py-24`/`lg:py-32` (96–128px) vertical section rhythm throughout — padding-driven, not viewport-height-driven.

## Motion

**Revised 2026-08-07** after a follow-up visual-diff pass (screenshots at matched scroll positions, plus reading the reference's actual CSS rules directly via its stylesheet — computed-style snapshots alone can't capture motion at all, which is why this was missed the first time).

- **Entrance reveal**: `.rw-reveal { opacity: 0; transform: translateY(18px); }`, `.rw-reveal.animate { animation: rw-rise 0.7s cubic-bezier(0.22,1,0.36,1) forwards; }` (`rw-rise`'s only keyframe is `100% { opacity: 1; transform: none; }` — it plays forward from whatever `.rw-reveal`'s base state already is). Fires on scroll-into-view, staggered in a consistent **80ms-per-item rhythm** (confirmed via `animation-delay`: hero elements at 60/140/220/300ms, card grids at 0/80/160ms). Reproduced via `useRevealOnScroll`/`Reveal` in `apps/web/src/components/landing/primitives.tsx`, applied across every section.
- **Card/button hover**: `.rw-card` transitions border-color/background-color/transform over 0.3s; `.rw-btn-primary` transitions transform/box-shadow/background-color over 0.25s. Both use the same single easing curve as the entrance reveal.
- **Ambient loop, independent of scroll or hover** — the single biggest thing the computed-style pass missed entirely: `.rw-kenburns` (22s, `cubic-bezier(0.45,0,0.55,1)`, infinite — scale 1.04→1.11 + slight pan, applied to a hero photo), `.rw-orbit` (28s, linear, infinite — 360° rotation on a ring/connector graphic), `.rw-breathe` (7s, ease-in-out, infinite — opacity 0.25↔0.6 + scale 0.94↔1.06 pulse on a glow). Reproduced as reusable `.rw-kenburns`/`.rw-orbit`/`.rw-breathe` utility classes in `tokens.css`; `rw-breathe` is applied now (hero background, final-CTA glow), `rw-kenburns`/`rw-orbit` await the hero illustration (PR B).
- **All landing motion uses one curve**, `cubic-bezier(0.22, 1, 0.36, 1)`, not the app's ceremony/calm registers — see ADR-018's second addendum. Landing-only tokens: `--duration-landing-entrance` (0.7s), `--duration-landing-hover` (0.3s), `--duration-landing-button` (0.25s), `--ease-landing`.
- **Scroll-scrubbed sequence**: the hero's "IDEA → TASKS → TEAMS → AGENTS → COMPANY" section is a `position: sticky` pinned viewport inside a 420vh-tall wrapper (6 steps × 70vh) — our implementation's wrapper height, sticky pin, and step-index math already matched exactly. What didn't: the reference **cross-fades** between steps (old content visibly fading out while new fades in, overlapping) where ours did a hard cut (React re-keying the block, old content vanishing instantly). Fixed via `CrossfadeStep` in `ScrollSequence.tsx` — newest step renders in normal flow, older (still-fading) steps stack via `absolute inset-0` and fade to opacity 0 before being pruned. The reference also shows a 6-segment gradient progress bar under each step (cumulative fill) and evolves its illustration per step — the progress bar is reproduced (`StepProgress`); the per-step illustration is PR B's job (needs the hero illustration to exist first).
- **Reduced motion**: `tokens.css`'s existing global block (`animation-duration`/`transition-duration: 0.01ms !important`, `animation-iteration-count: 1 !important`) already neutralizes every one of the above automatically — entrance reveals and hover transitions become instant, ambient loops play one (imperceptible) frame instead of looping forever, and the crossfade becomes an instant swap. No additional reduced-motion branching was needed beyond what the scroll-scrubbed pin's own separate static-list fallback already provides.

## Navigation

Persistent top nav (logo, "How It Works", "Pricing", "Sign In", mobile hamburger) and a footer with the same links + copyright. Reproduced. **Phase 1B (shipped)**: "How It Works" and "Pricing" are now real pages (`HowItWorksPage.tsx`, `PricingPage.tsx`) built from the reference's own copy — the reference's 8-step accordion and full FAQ, captured live by expanding every collapsed step. Two departures from a literal copy: (1) team/example content uses this app's own real taxonomy and `InteractivePreview.tsx`'s existing demo example rather than the reference's own demo personas; (2) numbers that would read as real product cost/performance data (an agent's per-day cost, a dashboard's daily spend total) are not reproduced — the reference itself ships tier prices as `—/month` placeholders with an on-page "Pricing not finalised" disclaimer, which `lib/pricingConstants.ts` matches with a `TODO(product)` rather than guessing a number.

## What was explicitly NOT copied, and what's still open

- Six additional marketing sections beyond the hero (product story, interactive idea-picker preview, control & safety, spending walls, BYOK explainer, dashboard preview, value comparison table) depict product surfaces that don't exist in `apps/web` yet. They were reproduced as clearly-illustrative static content (same convention as `reference.html`'s own disclaimer), not as claims those screens exist.
- Steps 2–6 of the scroll-scrubbed sequence's copy were placeholder text in the first pass (the reference's SPA only reveals each step's copy on real scroll, which this session's tooling couldn't initially drive) — **now corrected**: `ScrollSequence.tsx`'s `STEPS` array uses the reference's actual copy, captured via real scroll interaction in the follow-up visual-diff pass.
- **PR B (shipped)**: the hero's two-column layout and its animated illustration. **Correction, 2026-08-07 Phase 0 inventory**: the assumption above that the reference runs "a live force-directed simulation" was wrong — reading the reference's actual bundle turned up no d3-force, no physics/charting library, no WebGL/Three.js anywhere. It's a single hand-rolled canvas 2D `requestAnimationFrame` loop (one `getContext("2d")`, a handful of `.arc()`/`.moveTo`/`.lineTo` calls, `Math.cos`/`Math.sin`/`Math.random` for node positions). Our SVG + CSS transform/opacity implementation reaches the same visual territory without a JS draw loop or a new dependency — confirmed as the right call, not a compromise. Also shipped in PR B: per-step illustration evolution in the scroll sequence, the nav's logo mark, and the Spending Walls section's card restructure (one card with a real progress bar).
