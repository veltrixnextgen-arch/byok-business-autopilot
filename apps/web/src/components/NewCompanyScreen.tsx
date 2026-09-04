import { AppShell } from "./AppShell";
import { IdeaForm } from "./landing/IdeaForm";
import { Card } from "./ui";

// Found live 2026-09-04: CharterScreen's empty state used to send an
// already-signed-in user wanting to start a new company to "/" (the
// public marketing landing page) — technically correct (that's where
// IdeaForm's session-aware navigate() already sends a signed-in
// submitter straight to /interview, skipping /signup), but landing on a
// page with zero session-awareness (marketing nav, no dashboard chrome)
// reads as a logout even though nothing about the session changes. This
// screen exists so that destination is an authenticated one instead: same
// IdeaForm, same real submit path, just wrapped in AppShell rather than
// the marketing shell.
export function NewCompanyScreen() {
  return (
    <AppShell active="/new-company">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header className="mb-8 space-y-1">
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Start a new company</h1>
          <p className="text-text-secondary">
            This creates a separate company — it won't change or replace any company you already have.
          </p>
        </header>
        <Card>
          <IdeaForm buttonLabel="Start the interview" />
        </Card>
      </div>
    </AppShell>
  );
}
