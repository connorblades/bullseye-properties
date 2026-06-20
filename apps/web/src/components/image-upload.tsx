'use client';

/**
 * Client-side image upload with in-browser resize.
 *
 * For M1 the resized data URL goes into localStorage on the Deal record.
 * In M2 (Claude integration + storage), uploads move to Supabase Storage
 * via signed URLs, and the server-side EXIF / GPS scrub runs before persistence.
 * The component contract (value: data URL string, onChange callback) is the
 * boundary we keep stable across that migration.
 */

import { useRef, useState } from 'react';
import { Upload, X, ImageIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.78;
const MAX_FILE_BYTES = 8 * 1024 * 1024;

function resizeImage(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const img = new window.Image();
      img.onerror = () => reject(new Error('image decode failed'));
      img.onload = () => {
        const ratio = Math.min(1, MAX_DIMENSION / Math.max(img.width, img.height));
        const width = Math.round(img.width * ratio);
        const height = Math.round(img.height * ratio);
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('no canvas context')); return; }
        ctx.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL('image/jpeg', JPEG_QUALITY));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

export function ImageUpload({
  value,
  onChange,
  label = 'Upload image',
  aspectRatio = '4 / 3',
  height,
  className,
}: {
  value?: string;
  onChange: (dataUrl: string | undefined) => void;
  label?: string;
  aspectRatio?: string;
  height?: string;
  className?: string;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function handleFile(file: File) {
    setError(undefined);
    if (!file.type.startsWith('image/')) {
      setError('Image file only.');
      return;
    }
    if (file.size > MAX_FILE_BYTES) {
      setError(`File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB).`);
      return;
    }
    setBusy(true);
    try {
      const dataUrl = await resizeImage(file);
      onChange(dataUrl);
    } catch {
      setError('Could not process image.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={cn('w-full', className)} style={{ aspectRatio: height ? undefined : aspectRatio }}>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = '';
        }}
      />
      {value ? (
        <div className="relative w-full h-full" style={{ height: height ?? '100%' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={value}
            alt=""
            className="w-full h-full object-cover rounded-lg block"
            style={{ height: height ?? '100%' }}
          />
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="absolute top-2 right-2 w-7 h-7 bg-white/95 rounded-full flex items-center justify-center text-ink-mid hover:text-red-500 shadow-sm transition"
            aria-label="Remove image"
          >
            <X size={14} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={busy}
          className={cn(
            'w-full h-full border-2 border-dashed border-black/[0.1] rounded-lg flex flex-col items-center justify-center gap-1.5 text-ink-muted hover:border-navy/30 hover:text-navy transition bg-gradient-to-br from-gray-50 to-gray-100/60',
            busy && 'opacity-60 cursor-wait'
          )}
          style={{ height: height ?? '100%' }}
        >
          {busy ? <ImageIcon size={20} className="animate-pulse" /> : <Upload size={20} />}
          <div className="text-xs font-bold uppercase tracking-wider">{busy ? 'Processing...' : label}</div>
          <div className="text-[10px] text-ink-muted">Drag or click. Max 8MB. Resized to 1400px.</div>
          {error && <div className="text-[10px] text-red-500 font-semibold mt-1">{error}</div>}
        </button>
      )}
    </div>
  );
}

export function ImageGallery({
  images,
  onChange,
  max = 30,
  label = 'Add photo',
}: {
  images: string[];
  onChange: (images: string[]) => void;
  max?: number;
  label?: string;
}) {
  const remaining = Math.max(0, max - images.length);
  return (
    <div className="grid grid-cols-3 gap-3">
      {images.map((src, i) => (
        <div key={i} className="relative" style={{ aspectRatio: '4 / 3' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt="" className="w-full h-full object-cover rounded-lg" />
          <button
            type="button"
            onClick={() => onChange(images.filter((_, j) => j !== i))}
            className="absolute top-1.5 right-1.5 w-6 h-6 bg-white/95 rounded-full flex items-center justify-center text-ink-mid hover:text-red-500 shadow-sm"
            aria-label="Remove image"
          >
            <X size={12} />
          </button>
        </div>
      ))}
      {remaining > 0 && (
        <ImageUpload
          label={label}
          onChange={(d) => d && onChange([...images, d])}
        />
      )}
      {remaining === 0 && (
        <div className="text-xs text-ink-muted col-span-3 text-center py-2">Max {max} photos reached.</div>
      )}
    </div>
  );
}
