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

- Scroll reveal: `translateY(18px)` → none, opacity 0→1, 0.7s, `cubic-bezier(0.22,1,0.36,1)`. Structurally the same idea as our existing `rise-in` keyframe (`translateY(12px)`, same 700ms) — we kept our own `--duration-ceremony-*`/`--ease-ceremony` tokens rather than adopting their exact curve, per ADR-018's "reproduce the design, not the literal values" spirit.
- **Scroll-scrubbed sequence**: the hero's "IDEA → TASKS → TEAMS → AGENTS → COMPANY" section is a `position: sticky` pinned viewport inside a 420vh-tall wrapper (6 steps × 70vh), stepping through content as the user scrolls rather than revealing on a timer. Reproduced in `apps/web/src/components/landing/ScrollSequence.tsx` with a vanilla scroll listener (no library) and a static, unpinned stacked fallback for `prefers-reduced-motion`.

## Navigation

Persistent top nav (logo, "How It Works", "Pricing", "Sign In", mobile hamburger) and a footer with the same links + copyright. Reproduced; "How It Works" and "Pricing" route to plain coming-soon placeholders (`apps/web/src/components/landing/ComingSoonPage.tsx`) rather than being built out — that's separate, post-pilot work.

## What was explicitly NOT copied

- Six additional marketing sections beyond the hero (product story, interactive idea-picker preview, control & safety, spending walls, BYOK explainer, dashboard preview, value comparison table) depict product surfaces that don't exist in `apps/web` yet. They were reproduced as clearly-illustrative static content (same convention as `reference.html`'s own disclaimer), not as claims those screens exist.
- Steps 2–6 of the scroll-scrubbed sequence's copy: the reference is a client-rendered SPA that reveals each step's copy only as it's scrolled into view, and this session's browser tooling could not drive real scroll events against it to read that text. Step 1's copy was directly observed and matched; steps 2–6 are original copy in the same voice, describing the same idea → tasks → teams → agents → company arc the reference's own section title names.
