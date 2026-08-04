import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button, Card, Field, FormError, TextInput } from "../components/ui";
import { signUp } from "../lib/authClient";
import { loadIdea, recordFunnelEvent } from "../lib/extractionClient";

export const Route = createFileRoute("/signup")({
  component: Signup,
});

function Signup() {
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Sign up</h1>
        <p className="text-text-secondary">Meet your company in a few minutes.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Name" htmlFor="name">
            <TextInput id="name" type="text" value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </Field>
          <Field label="Email" htmlFor="email">
            <TextInput id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextInput
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
            />
          </Field>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="gradient" disabled={submitting} className="w-full justify-center">
            {submitting ? "Signing up…" : "Sign up"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-text-secondary">
        Already have an account?{" "}
        <Link to="/login" className="font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong">
          Sign in
        </Link>
      </p>
    </main>
  );
}
