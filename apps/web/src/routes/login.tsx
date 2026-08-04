import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button, Card, Field, FormError, TextInput } from "../components/ui";
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
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center gap-6 px-6 py-16">
      <div className="space-y-2 text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Sign in</h1>
        <p className="text-text-secondary">Welcome back.</p>
      </div>
      <Card>
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field label="Email" htmlFor="email">
            <TextInput id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
          </Field>
          <Field label="Password" htmlFor="password">
            <TextInput id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
          </Field>
          {error && <FormError>{error}</FormError>}
          <Button type="submit" variant="gradient" disabled={submitting} className="w-full justify-center">
            {submitting ? "Signing in…" : "Sign in"}
          </Button>
        </form>
      </Card>
      <p className="text-center text-sm text-text-secondary">
        No account?{" "}
        <Link to="/signup" className="font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong">
          Sign up
        </Link>
      </p>
    </main>
  );
}
