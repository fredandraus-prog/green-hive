export const DOCUMENT_RENDER_FORMATS = ['TEXT', 'PDF'] as const;
export type DocumentRenderFormat = (typeof DOCUMENT_RENDER_FORMATS)[number];

export interface RenderDocumentInput {
  readonly format: DocumentRenderFormat;
  readonly title: string;
  readonly lines: readonly string[];
}

export interface RenderedDocument {
  readonly content: Uint8Array;
  readonly mediaType: 'text/plain' | 'application/pdf';
  readonly extension: 'txt' | 'pdf';
}

export class DocumentRenderError extends Error {
  constructor() {
    super('Document render input is invalid');
    this.name = 'DocumentRenderError';
  }
}

const CONTROL_OR_BIDI = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const PRINTABLE_ASCII = /^[\x20-\x7e]*$/;
const INPUT_KEYS = new Set(['format', 'title', 'lines']);
const MAX_LINES = 120;
const MAX_LINE_LENGTH = 240;
const MAX_TOTAL_LENGTH = 16_000;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object'
    && value !== null
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function normalizeLine(value: unknown): string {
  if (typeof value !== 'string') throw new DocumentRenderError();
  const normalized = value.normalize('NFC').trim();
  if (!normalized || normalized.length > MAX_LINE_LENGTH || CONTROL_OR_BIDI.test(normalized)) {
    throw new DocumentRenderError();
  }
  return normalized;
}

function validate(input: unknown): Readonly<Required<RenderDocumentInput>> {
  if (!isPlainObject(input) || Object.keys(input).some((key) => !INPUT_KEYS.has(key))) {
    throw new DocumentRenderError();
  }
  if (input.format !== 'TEXT' && input.format !== 'PDF') throw new DocumentRenderError();
  if (!Array.isArray(input.lines) || input.lines.length > MAX_LINES) throw new DocumentRenderError();
  const title = normalizeLine(input.title);
  const lines = input.lines.map(normalizeLine);
  if (title.length + lines.reduce((total, line) => total + line.length, 0) > MAX_TOTAL_LENGTH) {
    throw new DocumentRenderError();
  }
  if (input.format === 'PDF' && ![title, ...lines].every((line) => PRINTABLE_ASCII.test(line))) {
    throw new DocumentRenderError();
  }
  return Object.freeze({ format: input.format, title, lines: Object.freeze(lines) });
}

function pdfEscape(value: string): string {
  return value.replace(/[\\()]/g, (character) => `\\${character}`);
}

function renderPdf(title: string, lines: readonly string[]): Uint8Array {
  const text = [title, ...lines]
    .map((line, index) => `${index === 0 ? '72 760 Td /F1 16 Tf' : '0 -20 Td /F1 11 Tf'} (${pdfEscape(line)}) Tj`)
    .join('\n');
  const stream = `BT\n${text}\nET\n`;
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream, 'ascii')} >>\nstream\n${stream}endstream`,
  ];
  let output = '%PDF-1.4\n';
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, 'ascii'));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, 'ascii');
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  output += offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return new TextEncoder().encode(output);
}

/** Deterministic server-side renderer; it never reads files, executes templates or reaches the network. */
export function renderDocument(input: unknown): RenderedDocument {
  const document = validate(input);
  if (document.format === 'TEXT') {
    return Object.freeze({
      content: new TextEncoder().encode([document.title, ...document.lines].join('\n').concat('\n')),
      mediaType: 'text/plain',
      extension: 'txt',
    });
  }
  return Object.freeze({
    content: renderPdf(document.title, document.lines),
    mediaType: 'application/pdf',
    extension: 'pdf',
  });
}
