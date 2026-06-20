'use client';

import { useRef } from 'react';
import { FileText, Map, FileBadge, ScrollText, FileQuestion, X, Upload, ExternalLink, type LucideIcon } from 'lucide-react';
import type { PropertyDocument, DocumentKind } from '@/lib/deal-store';
import { cn } from '@/lib/utils';

const KIND_META: Record<DocumentKind, { label: string; icon: LucideIcon; sourceNote: string }> = {
  'floor-plan':     { label: 'Floor plan',          icon: Map,         sourceNote: 'Usually on the Rightmove / Zoopla listing. Save as PDF and upload.' },
  'title-plan':     { label: 'Title plan',          icon: ScrollText,  sourceNote: 'HM Land Registry. £3 per official copy via gov.uk. Future: pulled automatically.' },
  'epc':            { label: 'EPC certificate',     icon: FileBadge,   sourceNote: 'Free from epcregister.com or find-energy-certificate.service.gov.uk. Future: pulled automatically.' },
  'land-registry':  { label: 'Land Registry title', icon: FileText,    sourceNote: 'HM Land Registry. £3 per official copy via gov.uk. Future: pulled automatically.' },
  'other':          { label: 'Other document',      icon: FileQuestion, sourceNote: 'Anything else: planning decision letter, lease, indemnity policy, etc.' },
};

const REQUIRED_KINDS: DocumentKind[] = ['floor-plan', 'title-plan', 'epc'];

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function DocumentSlot({
  kind, document, onChange,
}: {
  kind: DocumentKind;
  document?: PropertyDocument;
  onChange: (d: PropertyDocument | undefined) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const meta = KIND_META[kind];
  const Icon = meta.icon;

  async function handleFile(file: File) {
    if (file.size > 10 * 1024 * 1024) {
      window.alert('File too large (max 10MB).');
      return;
    }
    const dataUrl = await fileToDataUrl(file);
    onChange({
      id: document?.id ?? 'doc-' + Math.random().toString(36).slice(2, 8),
      kind,
      filename: file.name,
      imageData: dataUrl,
      source: 'uploaded',
    });
  }

  return (
    <div className="card p-5">
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />

      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-2.5">
          <div className="w-9 h-9 bg-navy/[0.08] rounded-lg flex items-center justify-center text-navy">
            <Icon size={16} />
          </div>
          <div>
            <div className="font-bold text-ink text-sm">{meta.label}</div>
            <div className="text-[10px] text-ink-muted">{meta.sourceNote}</div>
          </div>
        </div>
      </div>

      {document?.imageData ? (
        <div className="flex items-center justify-between gap-2 bg-bg rounded-lg p-3">
          <div className="flex-1 truncate">
            <div className="text-xs font-bold text-ink truncate">{document.filename}</div>
            <div className="text-[10px] text-ink-muted">Uploaded</div>
          </div>
          <a
            href={document.imageData}
            target="_blank"
            rel="noreferrer"
            className="text-ink-mid hover:text-navy"
            aria-label="Open"
          >
            <ExternalLink size={14} />
          </a>
          <button
            onClick={() => onChange(undefined)}
            className="text-ink-mid hover:text-red-500"
            aria-label="Remove"
          >
            <X size={16} />
          </button>
        </div>
      ) : (
        <button
          onClick={() => inputRef.current?.click()}
          className={cn(
            'w-full border-2 border-dashed border-black/[0.08] rounded-lg py-4 text-xs font-bold text-ink-muted hover:border-navy/30 hover:text-navy transition flex items-center justify-center gap-2',
          )}
        >
          <Upload size={14} /> Upload {meta.label}
        </button>
      )}
    </div>
  );
}

export function DocumentsUpload({
  documents,
  onChange,
}: {
  documents: PropertyDocument[];
  onChange: (next: PropertyDocument[]) => void;
}) {
  const setDoc = (kind: DocumentKind, doc: PropertyDocument | undefined) => {
    const others = documents.filter((d) => d.kind !== kind);
    onChange(doc ? [...others, doc] : others);
  };

  const byKind = (kind: DocumentKind) => documents.find((d) => d.kind === kind);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        {REQUIRED_KINDS.map((kind) => (
          <DocumentSlot key={kind} kind={kind} document={byKind(kind)} onChange={(d) => setDoc(kind, d)} />
        ))}
      </div>
      <DocumentSlot kind="land-registry" document={byKind('land-registry')} onChange={(d) => setDoc('land-registry', d)} />
    </div>
  );
}

export function DocumentsDisplay({ documents }: { documents: PropertyDocument[] }) {
  if (documents.length === 0) {
    return <div className="text-sm text-ink-muted">No documents uploaded yet.</div>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {documents.map((d) => {
        const meta = KIND_META[d.kind];
        const Icon = meta.icon;
        return (
          <div key={d.id} className="flex items-center gap-2 bg-bg rounded-lg p-2.5">
            <Icon size={14} className="text-navy flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs font-bold text-ink truncate">{meta.label}</div>
              <div className="text-[10px] text-ink-muted truncate">{d.filename}</div>
            </div>
            {d.imageData && (
              <a href={d.imageData} target="_blank" rel="noreferrer" className="text-ink-mid hover:text-navy">
                <ExternalLink size={12} />
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
}
