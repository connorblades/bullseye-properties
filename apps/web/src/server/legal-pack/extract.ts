import 'server-only';

/**
 * Server-side legal-pack text extraction (M11 / AC-18).
 *
 * PDF -> pdf-parse (pdfjs under the hood); DOCX -> mammoth. A scanned,
 * image-only pack yields little or no extractable text; rather than crash or
 * send an empty prompt to Claude, extraction returns a typed manual-entry
 * signal the panel surfaces as a warning.
 *
 * The pure decision (`classifyExtraction`) and the dispatch (`extractLegalPack`)
 * are separated so the degrade-to-warning path is unit-testable without real
 * binary documents: tests inject `parsePdf` / `parseDocx`.
 */

/** Below this many characters we treat a pack as non-extractable (image-only). */
export const MIN_EXTRACTABLE_CHARS = 200;

export type ManualEntryReason = 'image-only' | 'empty' | 'unsupported' | 'error';

export type ExtractResult =
  | { ok: true; text: string; pages: number }
  | { ok: false; reason: ManualEntryReason; message: string };

export type UploadedDoc = {
  filename: string;
  mime: string;
  bytes: Buffer;
};

/** Result of a low-level parse: the concatenated text and the page count. */
export type ParsedDoc = { text: string; pages: number };

export type ExtractDeps = {
  parsePdf?: (bytes: Buffer) => Promise<ParsedDoc>;
  parseDocx?: (bytes: Buffer) => Promise<ParsedDoc>;
};

const IMAGE_ONLY_MESSAGE =
  'This pack appears to be scanned images with no selectable text. Enter the buyer fees and conditions manually below.';

/**
 * Pure classification: given extracted text + page count, decide whether the
 * pack is usable or must degrade to manual entry. A pack with usable text below
 * the threshold (typical of a scanned/image-only PDF) is flagged image-only.
 */
export function classifyExtraction(parsed: ParsedDoc): ExtractResult {
  const text = (parsed.text ?? '').trim();
  if (text.length === 0) {
    return { ok: false, reason: 'empty', message: IMAGE_ONLY_MESSAGE };
  }
  if (text.length < MIN_EXTRACTABLE_CHARS) {
    return { ok: false, reason: 'image-only', message: IMAGE_ONLY_MESSAGE };
  }
  return { ok: true, text, pages: parsed.pages };
}

function isPdf(doc: UploadedDoc): boolean {
  return doc.mime === 'application/pdf' || /\.pdf$/i.test(doc.filename);
}
function isDocx(doc: UploadedDoc): boolean {
  return (
    doc.mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    /\.docx$/i.test(doc.filename)
  );
}

/** Default PDF parser: pdf-parse v2 (class API), text + page count. */
async function defaultParsePdf(bytes: Buffer): Promise<ParsedDoc> {
  const { PDFParse } = await import('pdf-parse');
  const parser = new PDFParse({ data: new Uint8Array(bytes) });
  try {
    const res = await parser.getText();
    return { text: res.text ?? '', pages: res.total ?? res.pages?.length ?? 0 };
  } finally {
    await parser.destroy().catch(() => {});
  }
}

/** Default DOCX parser: mammoth raw-text extraction (single logical page). */
async function defaultParseDocx(bytes: Buffer): Promise<ParsedDoc> {
  const mammoth = (await import('mammoth')).default;
  const res = await mammoth.extractRawText({ buffer: bytes });
  return { text: res.value ?? '', pages: 1 };
}

/**
 * Extract text from an uploaded PDF or DOCX. Never throws: a parse error or an
 * unsupported type returns a typed manual-entry signal instead.
 */
export async function extractLegalPack(doc: UploadedDoc, deps: ExtractDeps = {}): Promise<ExtractResult> {
  const parsePdf = deps.parsePdf ?? defaultParsePdf;
  const parseDocx = deps.parseDocx ?? defaultParseDocx;

  let parsed: ParsedDoc;
  try {
    if (isPdf(doc)) parsed = await parsePdf(doc.bytes);
    else if (isDocx(doc)) parsed = await parseDocx(doc.bytes);
    else {
      return {
        ok: false,
        reason: 'unsupported',
        message: 'Unsupported file type. Upload the legal pack as a PDF or a Word (.docx) document.',
      };
    }
  } catch (err) {
    return {
      ok: false,
      reason: 'error',
      message:
        err instanceof Error
          ? `Could not read the document: ${err.message}. Enter the details manually below.`
          : 'Could not read the document. Enter the details manually below.',
    };
  }

  return classifyExtraction(parsed);
}
