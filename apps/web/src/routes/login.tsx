import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { AuthField, AuthInput, AuthShell, AuthSubmitButton } from "../components/AuthShell";
import { FormError } from "../components/ui";
import { signIn } from "../lib/authClient";

export const Route = createFileRoute("/login")({
  component: Login,
});

function Login() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    const { error: signInError } = await signIn.email({ email, password });
    setSubmitting(false);
    if (signInError) {
      setError(signInError.message ?? "Sign in failed");
      return;
    }
    await navigate({ to: "/dashboard" });
  }

  return (
    <AuthShell
      eyebrow="Welcome back"
      headline={
        <>
          Your company is{" "}
          <span className="bg-gradient-to-br from-accent-strong to-cta-warm bg-clip-text text-transparent">waiting.</span>
        </>
      }
      subtitle="Sign in to continue running your company."
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        <AuthField label="Email" htmlFor="email">
          <AuthInput id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </AuthField>
        <AuthField label="Password" htmlFor="password">
          <AuthInput id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </AuthField>
        {error && <FormError>{error}</FormError>}
        <AuthSubmitButton type="submit" disabled={submitting}>
          {submitting ? "Signing in…" : "Sign in"}
        </AuthSubmitButton>
      </form>
      <p className="mt-6 text-sm text-text-secondary">
        No account?{" "}
        <Link to="/signup" className="font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong">
          Sign up
        </Link>
      </p>
    </AuthShell>
  );
}
