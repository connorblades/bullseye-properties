'use client';

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="min-h-screen flex items-center justify-center p-6 bg-bg">
      <div className="card max-w-lg p-8 space-y-4">
        <div className="badge">bpOS</div>
        <h1 className="text-2xl font-black">This page could not load</h1>
        <p className="text-ink-mid">Try loading it again. If you were making changes, check they were saved before continuing.</p>
        <div className="flex gap-3 flex-wrap">
          <button type="button" className="btn-primary" onClick={reset}>Try again</button>
          <a className="btn-secondary" href="/login">Return to sign-in</a>
        </div>
        {error.digest && <p className="text-xs text-ink-muted">Error reference: {error.digest}</p>}
      </div>
    </main>
  );
}
