import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { signUp } from "../lib/authClient";
import { loadIdea } from "../lib/extractionClient";

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
    // The idea box (route "/") is the normal way to arrive here — carry
    // that idea straight into the interview instead of dropping it on the
    // floor. Visiting /signup directly (no idea saved) falls back to the
    // pre-Step-5 destination.
    await navigate({ to: loadIdea() ? "/interview" : "/dashboard" });
  }

  return (
    <main>
      <h1>Sign up</h1>
      <form onSubmit={handleSubmit}>
        <label>
          Name
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label>
          Email
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        </label>
        <label>
          Password
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={8} required />
        </label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={submitting}>
          {submitting ? "Signing up…" : "Sign up"}
        </button>
      </form>
      <p>
        Already have an account? <Link to="/login">Sign in</Link>
      </p>
    </main>
  );
}
