// Issue #118 workaround: shown while useAuthGuard's client-side session
// check is still in flight — the only check that runs now, since SSR
// can't see a cross-site session cookie. Named explicitly rather than a
// bare "Loading…": an ambiguous loading state next to what looks like a
// broken/empty authenticated screen has cost real time on this project
// before.
export function SessionCheckingScreen() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-3">
      <div className="size-6 animate-spin rounded-full border-2 border-border-strong border-t-accent" aria-hidden="true" />
      <p className="text-sm text-text-muted">Checking your session…</p>
    </div>
  );
}
