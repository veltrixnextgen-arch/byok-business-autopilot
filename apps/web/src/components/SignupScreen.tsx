import { Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { loadIdea, recordFunnelEvent } from "../lib/extractionClient";
import { signUp } from "../lib/authClient";
import { AuthField, AuthInput, AuthShell, AuthSubmitButton } from "./AuthShell";
import { FormError } from "./ui";

// Split out of routes/signup.tsx (a plain export here, so it's directly
// testable) — same reason as InterviewScreen: TanStack Start's route-file
// compiler only lazy-splits a route's local `component`, and stops doing
// so the moment that same symbol is also exported for anything else.
export function SignupScreen() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signUpError } = await signUp.email({ name, email, password });
    setSubmitting(false);
    if (signUpError) {
      setError(signUpError.message ?? "Sign up failed");
      return;
    }
    recordFunnelEvent("signup");
    // The idea box (route "/") is the normal way to arrive here — carry
    // that idea straight into the interview instead of dropping it on the
    // floor. Visiting /signup directly (no idea saved) falls back to the
    // pre-Step-5 destination.
    await navigate({ to: loadIdea() ? "/interview" : "/dashboard" });
  }

  return (
    <AuthShell
      eyebrow="Get started"
      headline={
        <>
          Meet your{" "}
          <span className="bg-gradient-to-br from-accent-strong to-cta-warm bg-clip-text text-transparent">company.</span>
        </>
      }
      subtitle="Sign up to build it in a few minutes."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField label="Name" htmlFor="name">
          <AuthInput id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
        </AuthField>
        <AuthField label="Email" htmlFor="email">
          <AuthInput id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </AuthField>
        <AuthField label="Password" htmlFor="password">
          <AuthInput
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            minLength={8}
            required
          />
        </AuthField>
        {error && <FormError>{error}</FormError>}
        <AuthSubmitButton type="submit" disabled={submitting}>
          {submitting ? "Signing up…" : "Sign up"}
        </AuthSubmitButton>
      </form>
      <p className="mt-6 text-sm text-text-secondary">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
