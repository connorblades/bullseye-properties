import { Logo } from '@/components/logo';

/**
 * Branded, centred full-screen notice for the public share surfaces (M4) -
 * shown when a link is revoked, expired, or the report is not yet ready.
 */
export function ShareNotice({ title, body }: { title: string; body: string }) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-6">
      <div className="max-w-md text-center">
        <div className="flex justify-center mb-6">
          <Logo size="md" />
        </div>
        <h1 className="text-2xl font-black text-ink mb-3">{title}</h1>
        <p className="text-sm text-ink-mid leading-relaxed">{body}</p>
      </div>
    </div>
  );
}
