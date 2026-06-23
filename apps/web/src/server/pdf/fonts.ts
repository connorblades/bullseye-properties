import 'server-only';
import { Font } from '@react-pdf/renderer';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { NOTO_SANS_REGULAR_B64 } from './noto-base64';

/**
 * Font registration for the PDF (M3-T6).
 *
 * @react-pdf v4 will not render with the built-in PDF base-14 fonts in this
 * install (it throws `unitsPerEm` undefined), so a real embedded TTF must
 * always be present. We bundle Noto Sans (SIL OFL, already shipped by Next) as
 * a guaranteed fallback under the family "Bullseye Sans", and prefer the brand
 * faces - Inter (body) and Source Serif Pro (display) - when their TTFs are
 * dropped into public/fonts. No code change is needed to upgrade fidelity.
 *
 * Brand TTFs (optional, override the fallback):
 *   public/fonts/Inter-Regular.ttf, Inter-Bold.ttf, Inter-Black.ttf
 *   public/fonts/SourceSerifPro-Bold.ttf
 */

const FALLBACK_FAMILY = 'Bullseye Sans';

export const FONTS = { body: FALLBACK_FAMILY, display: FALLBACK_FAMILY };

let registered = false;

export function registerFonts(): void {
  if (registered) return;
  registered = true;

  // Never break across hyphens - cleaner wrapping for narrative prose.
  Font.registerHyphenationCallback((word) => [word]);

  const dir = path.join(process.cwd(), 'public', 'fonts');

  try {
    // Guaranteed fallback: the Noto Sans bytes are base64-embedded in the bundle
    // (noto-base64.ts) and registered via a data URI, so the font is present in
    // every runtime - including Vercel serverless routes, where public/ is NOT
    // traced into the lambda and a path-based register would silently fail and
    // crash @react-pdf with `unitsPerEm undefined`. One weight is mapped across
    // the scale so weight lookups resolve (bold renders as regular until a true
    // bold face is supplied).
    const fallback = `data:font/truetype;base64,${NOTO_SANS_REGULAR_B64}`;
    Font.register({
      family: FALLBACK_FAMILY,
      fonts: [
        { src: fallback, fontWeight: 400 },
        { src: fallback, fontWeight: 500 },
        { src: fallback, fontWeight: 700 },
        { src: fallback, fontWeight: 900 },
        // Italic maps to the same bytes (renders upright) so any `fontStyle:
        // 'italic'` resolves rather than crashing the layout engine.
        { src: fallback, fontWeight: 400, fontStyle: 'italic' },
        { src: fallback, fontWeight: 700, fontStyle: 'italic' },
      ],
    });

    // Brand body face (Inter) - preferred when present.
    const interRegular = path.join(dir, 'Inter-Regular.ttf');
    const interBold = path.join(dir, 'Inter-Bold.ttf');
    const interBlack = path.join(dir, 'Inter-Black.ttf');
    if (existsSync(interRegular) && existsSync(interBold)) {
      Font.register({
        family: 'Inter',
        fonts: [
          { src: interRegular, fontWeight: 400 },
          { src: interBold, fontWeight: 700 },
          ...(existsSync(interBlack) ? [{ src: interBlack, fontWeight: 900 }] : []),
        ],
      });
      FONTS.body = 'Inter';
    }

    // Brand display face (Source Serif Pro) - preferred when present.
    const serifBold = path.join(dir, 'SourceSerifPro-Bold.ttf');
    if (existsSync(serifBold)) {
      Font.register({ family: 'Source Serif Pro', fonts: [{ src: serifBold, fontWeight: 700 }] });
      FONTS.display = 'Source Serif Pro';
    }
  } catch {
    // A font path issue must never block a render; Noto fallback covers it.
  }
}
