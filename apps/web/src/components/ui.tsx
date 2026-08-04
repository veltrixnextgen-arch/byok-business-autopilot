import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

// No classnames/clsx dependency — this is the entire need, hand-rolled.
export function cx(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(" ");
}

type ButtonVariant = "primary" | "secondary" | "ghost" | "gradient";

export function Button({
  variant = "primary",
  className,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      className={cx(
        "inline-flex items-center justify-center font-body text-sm font-medium transition-[transform,background-color,border-color,box-shadow] duration-calm-fast ease-calm disabled:cursor-not-allowed disabled:opacity-50",
        variant === "primary" && "rounded-full px-5 py-2.5 bg-accent text-bg hover:-translate-y-px hover:shadow-glow-accent",
        variant === "secondary" && "rounded-full px-5 py-2.5 border border-border bg-bg-glass text-text hover:border-border-strong",
        variant === "ghost" && "rounded-full px-5 py-2.5 text-text-secondary hover:text-text",
        // The one or two primary actions per screen that move a signup
        // forward (STEP 7 design fidelity pass) — the reference's own
        // gradient CTA treatment: 12px radius, not a pill, plus its glow.
        variant === "gradient" &&
          "rounded-lg px-6 py-3.5 font-semibold text-white bg-gradient-to-br from-accent-strong to-cta-warm hover:-translate-y-px hover:shadow-glow-cta",
        className,
      )}
      {...props}
    />
  );
}

export function Card({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cx("rounded-2xl border border-border bg-bg-glass p-6 shadow-card backdrop-blur-glass-sm", className)}>
      {children}
    </div>
  );
}

export type BadgeTone = "accent" | "money" | "clients" | "marketing" | "operations" | "danger";

const badgeToneClasses: Record<BadgeTone, string> = {
  accent: "bg-accent/15 text-accent border-accent/30",
  money: "bg-money/15 text-money border-money/30",
  clients: "bg-clients/15 text-clients border-clients/30",
  marketing: "bg-marketing/15 text-marketing border-marketing/30",
  operations: "bg-operations/15 text-operations border-operations/30",
  danger: "bg-danger/15 text-danger border-danger/30",
};

export function Badge({ tone = "accent", children }: { tone?: BadgeTone; children: ReactNode }) {
  return (
    <span className={cx("inline-flex items-center rounded-full border px-3 py-1 font-mono text-xs tracking-wide", badgeToneClasses[tone])}>
      {children}
    </span>
  );
}

export function TextInput({ className, ...props }: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cx(
        "w-full rounded-md border border-border bg-bg-glass px-3.5 py-2.5 font-body text-text placeholder:text-text-muted transition-colors duration-calm-fast ease-calm focus:border-accent focus:outline-none",
        className,
      )}
      {...props}
    />
  );
}
