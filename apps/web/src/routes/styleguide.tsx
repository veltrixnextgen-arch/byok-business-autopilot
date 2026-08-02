import { createFileRoute } from "@tanstack/react-router";
import { Badge, Button, Card, TextInput } from "../components/ui";

export const Route = createFileRoute("/styleguide")({
  component: Styleguide,
});

// Every token and base component rendered in one place — the living
// reference for what "on brand" means, extracted (not copied) from the
// Runwisely design reference. Dark-first: no light-mode variant exists.
function Styleguide() {
  return (
    <main className="mx-auto max-w-5xl space-y-16 px-6 py-16">
      <header className="space-y-2">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Design system</p>
        <h1 className="font-display text-4xl font-semibold">Styleguide</h1>
        <p className="max-w-2xl text-text-secondary">
          Every token and base component this app is built from. Extracted from the Runwisely design reference, not copied — this
          prototype's hardcoded demo data stays out of the codebase.
        </p>
      </header>

      <Section title="Color — surfaces & text">
        <Swatches
          items={[
            { name: "bg", className: "bg-bg" },
            { name: "bg-elevated", className: "bg-bg-elevated" },
            { name: "bg-glass", className: "bg-bg-glass" },
            { name: "text", className: "bg-text" },
            { name: "text-secondary", className: "bg-text-secondary" },
            { name: "text-muted", className: "bg-text-muted" },
            { name: "border", className: "bg-border" },
          ]}
        />
      </Section>

      <Section title="Color — accents (one brand hue, four team hues)">
        <Swatches
          items={[
            { name: "accent", className: "bg-accent" },
            { name: "money", className: "bg-money" },
            { name: "clients", className: "bg-clients" },
            { name: "marketing", className: "bg-marketing" },
            { name: "operations", className: "bg-operations" },
            { name: "danger (not in reference)", className: "bg-danger" },
          ]}
        />
      </Section>

      <Section title="Type scale">
        <div className="space-y-3">
          {(["text-5xl", "text-3xl", "text-xl", "text-base", "text-sm", "text-xs"] as const).map((size) => (
            <p key={size} className={`font-display ${size}`}>
              {size} — Meet your company
            </p>
          ))}
          <p className="font-body text-base">font-body — Hanken Grotesk, the UI and copy face.</p>
          <p className="font-mono text-base">font-mono — Spline Sans Mono, for numbers and labels.</p>
        </div>
      </Section>

      <Section title="Spacing">
        <div className="flex flex-wrap items-end gap-4">
          {[1, 2, 3, 4, 5, 6, 8, 10, 12, 16].map((n) => (
            <div key={n} className="flex flex-col items-center gap-1">
              <div className="bg-accent/40" style={{ width: `calc(var(--spacing) * ${n})`, height: `calc(var(--spacing) * ${n})` }} />
              <span className="font-mono text-xs text-text-muted">{n}</span>
            </div>
          ))}
        </div>
      </Section>

      <Section title="Radius">
        <div className="flex flex-wrap gap-4">
          {/* Full literal class names — Tailwind can't statically detect
              a dynamically-interpolated `rounded-${r}` at build time. */}
          {[
            { name: "sm", className: "rounded-sm" },
            { name: "md", className: "rounded-md" },
            { name: "lg", className: "rounded-lg" },
            { name: "xl", className: "rounded-xl" },
            { name: "2xl", className: "rounded-2xl" },
            { name: "3xl", className: "rounded-3xl" },
            { name: "full", className: "rounded-full" },
          ].map((r) => (
            <div
              key={r.name}
              className={`flex h-16 w-16 items-center justify-center border border-border bg-bg-glass font-mono text-xs ${r.className}`}
            >
              {r.name}
            </div>
          ))}
        </div>
      </Section>

      <Section title="Shadow & glow">
        <div className="flex flex-wrap gap-6">
          <div className="h-20 w-32 rounded-xl bg-bg-elevated shadow-card" />
          <div className="h-20 w-32 rounded-xl bg-bg-elevated shadow-glow-accent" />
          <div className="h-20 w-32 rounded-xl bg-bg-elevated shadow-glow-money" />
          <div className="h-20 w-32 rounded-xl bg-bg-elevated shadow-glow-clients" />
        </div>
      </Section>

      <Section title="Glass">
        <div className="relative flex h-32 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-accent/30 to-money/20 p-6">
          <div className="rounded-xl border border-border bg-bg-glass px-6 py-4 backdrop-blur-glass-md">
            <p className="font-body text-sm">backdrop-blur-glass-md over an ambient gradient</p>
          </div>
        </div>
      </Section>

      <Section title="Motion — ceremony vs calm">
        <p className="mb-4 max-w-2xl text-sm text-text-secondary">
          Ceremony is for moments that should feel earned (landing, org-chart reveal, Charter handoff). Calm is for everything
          routine (queue, digest, dashboard, interview). Hover each box — both respect prefers-reduced-motion.
        </p>
        <div className="flex gap-6">
          <div className="group h-20 w-40 rounded-xl border border-border bg-bg-glass p-4 duration-ceremony-slow ease-ceremony hover:scale-105">
            <p className="font-mono text-xs text-text-muted">ceremony (1100ms)</p>
          </div>
          <div className="group h-20 w-40 rounded-xl border border-border bg-bg-glass p-4 duration-calm-fast ease-calm hover:scale-105">
            <p className="font-mono text-xs text-text-muted">calm (120ms)</p>
          </div>
        </div>
      </Section>

      <Section title="Base components">
        <div className="flex flex-wrap items-center gap-4">
          <Button variant="primary">Primary</Button>
          <Button variant="secondary">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" disabled>
            Disabled
          </Button>
        </div>
        <div className="mt-6 flex flex-wrap gap-3">
          <Badge tone="accent">accent</Badge>
          <Badge tone="money">money</Badge>
          <Badge tone="clients">clients</Badge>
          <Badge tone="marketing">marketing</Badge>
          <Badge tone="operations">operations</Badge>
          <Badge tone="danger">danger</Badge>
        </div>
        <Card className="mt-6 max-w-sm">
          <p className="font-display text-lg font-semibold">Card</p>
          <p className="mt-1 text-sm text-text-secondary">Glass panel, base radius, base shadow.</p>
        </Card>
        <div className="mt-6 max-w-sm">
          <TextInput placeholder="Text input" />
        </div>
      </Section>
    </main>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="font-display text-lg font-semibold text-text-secondary">{title}</h2>
      {children}
    </section>
  );
}

function Swatches({ items }: { items: Array<{ name: string; className: string }> }) {
  return (
    <div className="flex flex-wrap gap-4">
      {items.map((item) => (
        <div key={item.name} className="flex flex-col items-center gap-2">
          <div className={`h-16 w-16 rounded-lg border border-border ${item.className}`} />
          <span className="font-mono text-xs text-text-muted">{item.name}</span>
        </div>
      ))}
    </div>
  );
}
