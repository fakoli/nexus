import { randomBytes } from "crypto";

// Unicode angle-bracket variants and invisible formatting characters to strip/fold
// U+2039/U+203A: single angle quotation marks ‹ ›
// U+27E8/U+27E9: mathematical angle brackets ⟨ ⟩
// U+3008/U+3009: CJK angle brackets 〈 〉
// U+300A/U+300B: double CJK angle brackets 《 》
// U+FE3D/U+FE3E, U+FE64/U+FE65: small/fullwidth variants
// U+FF1C/U+FF1E: fullwidth less/greater
const UNICODE_ANGLE_OPEN = /[\u2039\u27E8\u3008\u300A\uFE3D\uFE64\uFF1C]/g;
const UNICODE_ANGLE_CLOSE = /[\u203A\u27E9\u3009\u300B\uFE3E\uFE65\uFF1E]/g;

// Invisible formatting / direction-override characters
const INVISIBLE_FORMAT = /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF]/g;

// Zero-width characters
const ZERO_WIDTH = /[\u00AD\u034F\u061C\u115F\u1160\u17B4\u17B5\u3164\uFFA0]/g;

export function sanitizeMarkers(text: string): string {
  return text
    .replace(UNICODE_ANGLE_OPEN, "<")
    .replace(UNICODE_ANGLE_CLOSE, ">")
    .replace(INVISIBLE_FORMAT, "")
    .replace(ZERO_WIDTH, "");
}

export interface BoundaryMetadata {
  id: string;
  source: string;
  extra: Record<string, string>;
}

export function wrapExternalContent(
  source: string,
  content: string,
  metadata?: Record<string, string>,
): string {
  const id = randomBytes(8).toString("hex");

  const metaAttrs = metadata
    ? Object.entries(metadata)
        .map(([k, v]) => ` ${k}="${escapeAttr(v)}"`)
        .join("")
    : "";

  const sanitizedContent = sanitizeMarkers(content);
  const openTag = `<<<EXTERNAL_UNTRUSTED_CONTENT id="${id}" source="${escapeAttr(source)}"${metaAttrs}>>>`;
  const closeTag = "<<<END_EXTERNAL_CONTENT>>>";

  return `${openTag}\n${sanitizedContent}\n${closeTag}`;
}

export function extractBoundaryMetadata(wrapped: string): BoundaryMetadata | null {
  const openRe = /<<<EXTERNAL_UNTRUSTED_CONTENT id="([^"]+)" source="([^"]*)"([^>]*)>>>/;
  const match = openRe.exec(wrapped);
  if (!match) return null;

  const [, id, source, rest] = match;
  const extra: Record<string, string> = {};

  const attrRe = /(\w+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = attrRe.exec(rest)) !== null) {
    extra[m[1]] = m[2];
  }

  return { id, source, extra };
}

function escapeAttr(value: string): string {
  return value.replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
