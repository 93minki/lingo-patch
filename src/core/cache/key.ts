import type { GlossaryEntry } from '../glossary/types';
import { normalizeMarkup } from '../segment';

const placeholderStrip = /<x\d+\/>|<\/?g\d+>/gu;

const entities: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
};

function stripPlaceholders(markup: string): string {
  return markup.replace(placeholderStrip, '');
}

function decodeEntitiesOnce(text: string): string {
  return text.replace(
    /&(?:amp|lt|gt|quot|#39);/gu,
    (entity) => entities[entity]!,
  );
}

function searchTextFromMarkup(markup: string): string {
  return normalizeMarkup(decodeEntitiesOnce(stripPlaceholders(markup)));
}

function escapeRegExp(term: string): string {
  return term.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function termAppears(text: string, entry: GlossaryEntry): boolean {
  if (!entry.term) return false;
  const escaped = escapeRegExp(entry.term);
  const flags = entry.caseSensitive ? 'u' : 'iu';
  const pattern = `(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`;
  return new RegExp(pattern, flags).test(text);
}

function compareAscii(a: string, b: string): number {
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

function compareEntries(a: GlossaryEntry, b: GlossaryEntry): number {
  return (
    compareAscii(a.term, b.term) ||
    compareAscii(a.mode, b.mode) ||
    compareAscii(a.target ?? '', b.target ?? '') ||
    Number(a.caseSensitive) - Number(b.caseSensitive)
  );
}

function encodeEntry(entry: GlossaryEntry): string {
  return JSON.stringify([
    entry.term,
    entry.mode,
    entry.target ?? '',
    entry.caseSensitive,
  ]);
}

export function glossaryFingerprint(
  markup: string,
  entries: GlossaryEntry[],
): string {
  const text = searchTextFromMarkup(markup);
  const matched = entries.filter((entry) => termAppears(text, entry));
  if (matched.length === 0) return '';
  matched.sort(compareEntries);
  return matched.map(encodeEntry).join('\n');
}

async function sha256Hex32(payload: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(payload),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 32);
}

export async function makeCacheKey(input: {
  markup: string;
  targetLang: string;
  promptVersion: number;
  glossary?: GlossaryEntry[];
}): Promise<string> {
  const fingerprint = glossaryFingerprint(input.markup, input.glossary ?? []);
  const material = JSON.stringify([
    normalizeMarkup(input.markup),
    input.targetLang,
    input.promptVersion,
    fingerprint,
  ]);
  return sha256Hex32(material);
}
