import { describe, expect, test } from 'vitest';
import { glossaryFingerprint, makeCacheKey } from '../../../src/core/cache/key';
import type { GlossaryEntry } from '../../../src/core/glossary/types';
import { PROMPT_VERSION } from '../../../src/core/prompt/version';

const base = {
  markup: 'Call <x0/> at the <g1>top level</g1>.',
  targetLang: 'ko',
  promptVersion: PROMPT_VERSION,
};

async function keyOf(
  overrides: Partial<typeof base & { glossary?: GlossaryEntry[] }> = {},
) {
  return makeCacheKey({ ...base, ...overrides });
}

describe('makeCacheKey', () => {
  test('same input yields the same key', async () => {
    const a = await keyOf();
    const b = await keyOf();
    expect(a).toBe(b);
  });

  test('whitespace-only markup differences normalize to the same key', async () => {
    const compact = await keyOf({ markup: 'Hello <x0/> world.' });
    const spaced = await keyOf({
      markup: '  Hello   <x0/>\n\tworld.  ',
    });
    expect(compact).toBe(spaced);
  });

  test('targetLang change yields a different key', async () => {
    expect(await keyOf({ targetLang: 'ko' })).not.toBe(
      await keyOf({ targetLang: 'ja' }),
    );
  });

  test('promptVersion change yields a different key', async () => {
    expect(await keyOf({ promptVersion: 1 })).not.toBe(
      await keyOf({ promptVersion: 2 }),
    );
  });

  test('changing a glossary entry that appears in markup changes the key', async () => {
    const glossary: GlossaryEntry[] = [
      { term: 'top', mode: 'map', target: '상단', caseSensitive: false },
    ];
    const first = await keyOf({ glossary });
    const second = await keyOf({
      glossary: [
        { term: 'top', mode: 'map', target: '최상위', caseSensitive: false },
      ],
    });
    expect(first).not.toBe(second);
  });

  test('changing a glossary entry that does not appear leaves the key unchanged', async () => {
    const absent: GlossaryEntry[] = [
      { term: 'missing', mode: 'keep', caseSensitive: false },
    ];
    const changed: GlossaryEntry[] = [
      { term: 'missing', mode: 'map', target: '없음', caseSensitive: true },
    ];
    expect(await keyOf({ glossary: absent })).toBe(
      await keyOf({ glossary: changed }),
    );
  });

  test('returns a 32-character lowercase hex string', async () => {
    const key = await keyOf();
    expect(key).toHaveLength(32);
    expect(key).toMatch(/^[0-9a-f]{32}$/u);
  });
});

describe('glossaryFingerprint', () => {
  const markup = 'Use <x0/> and React hooks for state management.';

  test('sorts matched entries deterministically regardless of input order', () => {
    const a: GlossaryEntry[] = [
      { term: 'state', mode: 'keep', caseSensitive: false },
      { term: 'React', mode: 'keep', caseSensitive: true },
    ];
    const b: GlossaryEntry[] = [a[1]!, a[0]!];
    expect(glossaryFingerprint(markup, a)).toBe(glossaryFingerprint(markup, b));
    expect(glossaryFingerprint(markup, a)).toContain('["React","keep"');
    expect(glossaryFingerprint(markup, a)).toContain('["state","keep"');
  });

  test('is stable for equivalent entries with different property creation order', () => {
    const ordered: GlossaryEntry = {
      term: 'React',
      mode: 'keep',
      caseSensitive: true,
    };
    const reordered: GlossaryEntry = {
      caseSensitive: true,
      mode: 'keep',
      term: 'React',
    };
    expect(glossaryFingerprint('React docs', [ordered])).toBe(
      glossaryFingerprint('React docs', [reordered]),
    );
  });

  test('matches terms on unicode boundaries only (no partial words)', () => {
    const entries: GlossaryEntry[] = [
      { term: 'state', mode: 'keep', caseSensitive: false },
    ];
    expect(glossaryFingerprint('useState rocks', entries)).toBe('');
    expect(glossaryFingerprint('manage state here', entries)).not.toBe('');
  });

  test('matches C++ and other non-word-edge punctuation terms', () => {
    const entries: GlossaryEntry[] = [
      { term: 'C++', mode: 'keep', caseSensitive: true },
    ];
    expect(glossaryFingerprint('learn C++ today', entries)).not.toBe('');
    expect(glossaryFingerprint('learn C today', entries)).toBe('');
  });

  test('matches Korean terms with unicode boundaries', () => {
    const entries: GlossaryEntry[] = [
      {
        term: '번역',
        mode: 'map',
        target: 'translation',
        caseSensitive: false,
      },
    ];
    expect(glossaryFingerprint('문단 번역 테스트', entries)).not.toBe('');
    expect(glossaryFingerprint('문단번역테스트', entries)).toBe('');
  });

  test('respects caseSensitive matching', () => {
    const entries: GlossaryEntry[] = [
      { term: 'React', mode: 'keep', caseSensitive: true },
    ];
    expect(glossaryFingerprint('react docs', entries)).toBe('');
    expect(glossaryFingerprint('React docs', entries)).not.toBe('');
  });

  test('escapes regex-special characters in terms', () => {
    const entries: GlossaryEntry[] = [
      { term: 'a+b', mode: 'keep', caseSensitive: true },
    ];
    expect(glossaryFingerprint('formula a+b end', entries)).not.toBe('');
    expect(glossaryFingerprint('formula ab end', entries)).toBe('');
  });

  test('decodes HTML entities once for term matching', () => {
    const entries: GlossaryEntry[] = [
      { term: 'AT&T', mode: 'keep', caseSensitive: true },
    ];
    expect(glossaryFingerprint('vendor AT&amp;T network', entries)).not.toBe(
      '',
    );
    expect(glossaryFingerprint('still &amp;amp;T', entries)).toBe('');
  });

  test('does not double-decode entity literals after one pass', () => {
    const entries: GlossaryEntry[] = [
      { term: '<', mode: 'keep', caseSensitive: true },
    ];
    expect(glossaryFingerprint('angle &amp;lt; bracket', entries)).toBe('');
    expect(glossaryFingerprint('angle &lt; bracket', entries)).not.toBe('');
  });

  test('ignores empty glossary terms', () => {
    const entries: GlossaryEntry[] = [
      { term: '', mode: 'keep', caseSensitive: false },
    ];
    expect(glossaryFingerprint('anything', entries)).toBe('');
  });
});
