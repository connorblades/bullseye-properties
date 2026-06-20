import Link from 'next/link';
import Image from 'next/image';
import { ArrowRight, ShieldCheck, FileText, Users } from 'lucide-react';

export default function Home() {
  return (
    <main className="min-h-screen bg-gradient-to-br from-navy-dark via-navy to-navy-light">
      <div className="max-w-5xl mx-auto px-6 pt-12">
        <Link href="/" className="inline-flex items-center">
          <Image src="/logo-white.png" alt="Bullseye Properties" width={160} height={40} priority style={{ height: 40, width: 'auto' }} />
        </Link>
      </div>
      <div className="max-w-5xl mx-auto px-6 py-16 text-white">
        <div className="inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-white/85 bg-white/10 border border-white/20 px-2.5 py-1 rounded mb-6">
          Accredited Partner Platform
        </div>
        <h1 className="text-5xl md:text-6xl font-black tracking-tight mb-6 leading-[1.05]">
          The standard for<br />
          <span className="text-white/80">UK property sourcing.</span>
        </h1>
        <p className="text-lg text-white/80 max-w-2xl mb-10 leading-relaxed">
          Bullseye-accredited partners run every deal through the same rigorous framework, then produce reports investors can trust on sight.
        </p>
        <div className="flex flex-wrap gap-3 mb-16">
          <Link
            href="/login"
            className="inline-flex items-center gap-2 bg-white text-navy font-bold px-7 py-3.5 rounded-lg shadow-lg hover:bg-white/95 transition-all hover:-translate-y-0.5"
          >
            Sign in <ArrowRight size={18} />
          </Link>
          <Link
            href="/login"
            className="inline-flex items-center gap-2 border border-white/30 bg-transparent text-white font-semibold px-6 py-3 rounded-lg hover:bg-white/10 transition"
          >
            Request access
          </Link>
        </div>
        <div className="grid md:grid-cols-3 gap-4 max-w-4xl">
          {[
            { icon: FileText, title: 'Standard Deal Report', desc: 'Every deal, same shape. Investors recognise it on sight.' },
            { icon: ShieldCheck, title: 'Compliance umbrella', desc: 'Trade under our AML, ICO and PI registrations while you train.' },
            { icon: Users, title: 'Referral network', desc: 'Pass leads across regions. 30 / 70 split logged automatically.' },
          ].map((f, i) => (
            <div key={i} className="bg-white/[0.06] border border-white/10 rounded-2xl p-6 backdrop-blur">
              <f.icon size={28} className="text-white/80 mb-3" />
              <div className="font-bold text-white mb-1">{f.title}</div>
              <div className="text-sm text-white/70 leading-relaxed">{f.desc}</div>
            </div>
          ))}
        </div>
      </div>
    </main>
  );
}
