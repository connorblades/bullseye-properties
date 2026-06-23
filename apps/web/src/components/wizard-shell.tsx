import { ReactNode } from 'react';
import Link from 'next/link';
import { Check, Lock } from 'lucide-react';
import { Nav } from './nav';
import { SECTIONS, WIZARD_PHASES } from '@/lib/sections';
import { cn } from '@/lib/utils';

export function WizardShell({
  dealId,
  currentStep,
  userEmail,
  signOutAction,
  children,
}: {
  dealId: string;
  currentStep: number;
  userEmail?: string;
  signOutAction?: () => Promise<void>;
  children: ReactNode;
}) {
  const current = SECTIONS[currentStep - 1];
  return (
    <div className="min-h-screen">
      <Nav userEmail={userEmail} signOutAction={signOutAction} />
      <div className="max-w-7xl mx-auto px-6 py-8 grid grid-cols-12 gap-8">
        <aside className="col-span-12 md:col-span-3">
          <div className="card p-5 md:sticky md:top-24">
            <div className="text-xs font-bold text-ink-muted uppercase tracking-wider mb-1">Deal {dealId}</div>
            <div className="text-sm font-bold text-ink mb-5">Sourcing Framework</div>
            <ol className="space-y-1">
              {SECTIONS.map((s, i) => {
                const stepN = i + 1;
                const status = stepN < currentStep ? 'done' : stepN === currentStep ? 'current' : 'locked';
                const firstInPhase = i === 0 || SECTIONS[i - 1].phase !== s.phase;
                const phaseMeta = WIZARD_PHASES.find((p) => p.key === s.phase);
                return (
                  <li key={s.id}>
                    {firstInPhase && phaseMeta && (
                      <div className="mt-4 first:mt-0 mb-1.5 px-1">
                        <div className="text-[10px] font-black text-navy uppercase tracking-wider">{phaseMeta.label}</div>
                        <div className="text-[10px] text-ink-muted leading-tight">{phaseMeta.produces}</div>
                      </div>
                    )}
                    <Link
                      href={status === 'locked' ? '#' : `/deal/${dealId}/wizard/${stepN}`}
                      className={cn(
                        'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition',
                        status === 'current' && 'bg-navy/[0.08] text-navy font-bold',
                        status === 'done' && 'text-ink-mid hover:bg-bg',
                        status === 'locked' && 'text-ink-muted cursor-not-allowed opacity-60'
                      )}
                    >
                      <div className={cn(
                        'w-6 h-6 rounded-md flex items-center justify-center text-[10px] font-black flex-shrink-0',
                        status === 'current' && 'bg-navy text-white',
                        status === 'done' && 'bg-success text-white',
                        status === 'locked' && 'bg-black/5 text-ink-muted'
                      )}>
                        {status === 'done' ? <Check size={12} /> : status === 'locked' ? <Lock size={10} /> : stepN}
                      </div>
                      <div className="flex-1 leading-tight">{s.short}</div>
                      {s.conditional && status !== 'current' && (
                        <span className="text-[10px] text-ink-muted uppercase tracking-wider">if</span>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ol>
          </div>
        </aside>
        <section className="col-span-12 md:col-span-9">
          <div className="badge mb-3">Stage {currentStep} of {SECTIONS.length}</div>
          <h1 className="text-3xl font-black text-ink mb-2">{current.title}</h1>
          <p className="text-ink-mid mb-8 max-w-2xl">{current.description}</p>
          {children}
        </section>
      </div>
    </div>
  );
}
