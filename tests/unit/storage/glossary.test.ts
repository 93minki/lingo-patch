import { describe, expect, test } from 'vitest';
import { makeCacheKey } from '../../../src/core/cache/key';
import { DEFAULT_GLOSSARY } from '../../../src/core/glossary/defaults';
import { PROMPT_VERSION } from '../../../src/core/prompt/version';
import {
  effectiveGlossary,
  emptyGlossary,
  normalizeGlossary,
} from '../../../src/storage/glossary';

describe('normalizeGlossary', () => {
  test('returns defaults for invalid storage payloads', () => {
    expect(normalizeGlossary(null)).toEqual(emptyGlossary());
    expect(normalizeGlossary([])).toEqual(emptyGlossary());
    expect(normalizeGlossary('bad')).toEqual(emptyGlossary());
  });

  test('filters invalid entries and normalizes hostnames', () => {
    const normalized = normalizeGlossary({
      global: [
        { term: '  valid  ', mode: 'keep', caseSensitive: false },
        { term: '', mode: 'keep', caseSensitive: false },
        { term: 'x'.repeat(201), mode: 'keep', caseSensitive: false },
        { term: 'needs-target', mode: 'map', caseSensitive: false },
      ],
      sites: {
        'Docs.Example.COM': [
          {
            term: 'site-only',
            mode: 'map',
            target: '사이트',
            caseSensitive: true,
          },
        ],
        'bad/host': [{ term: 'nope', mode: 'keep', caseSensitive: false }],
      },
      useDefaults: false,
    });
    expect(normalized.global).toEqual([
      { term: 'valid', mode: 'keep', caseSensitive: false },
    ]);
    expect(normalized.sites['docs.example.com']).toEqual([
      { term: 'site-only', mode: 'map', target: '사이트', caseSensitive: true },
    ]);
    expect(normalized.useDefaults).toBe(false);
  });

  test('treats missing useDefaults as enabled', () => {
    expect(normalizeGlossary({ global: [], sites: {} }).useDefaults).toBe(true);
  });
});

describe('effectiveGlossary', () => {
  test('merges defaults, global, and site entries with site winning on duplicate terms', () => {
    const glossary = normalizeGlossary({
      useDefaults: true,
      global: [
        { term: 'state', mode: 'map', target: '상태', caseSensitive: false },
      ],
      sites: {
        'docs.example.com': [
          { term: 'state', mode: 'keep', caseSensitive: false },
          {
            term: 'router',
            mode: 'map',
            target: '라우터',
            caseSensitive: false,
          },
        ],
      },
    });
    const effective = effectiveGlossary(glossary, 'docs.example.com');
    const byTerm = new Map(
      effective.map((entry) => [entry.term.toLowerCase(), entry]),
    );
    expect(byTerm.get('state')).toMatchObject({ mode: 'keep' });
    expect(byTerm.get('router')).toMatchObject({
      mode: 'map',
      target: '라우터',
    });
    expect(byTerm.get('props')?.mode).toBe('keep');
    expect(effective.length).toBe(DEFAULT_GLOSSARY.length);
  });

  test('omits built-in defaults when useDefaults is false', () => {
    const glossary = normalizeGlossary({
      useDefaults: false,
      global: [{ term: 'custom', mode: 'keep', caseSensitive: false }],
      sites: {},
    });
    expect(effectiveGlossary(glossary, 'example.com')).toEqual([
      { term: 'custom', mode: 'keep', caseSensitive: false },
    ]);
  });

  test('applies global entries on hosts without site overrides', () => {
    const glossary = normalizeGlossary({
      useDefaults: false,
      global: [{ term: 'API', mode: 'keep', caseSensitive: true }],
      sites: {
        'other.test': [
          {
            term: 'API',
            mode: 'map',
            target: '인터페이스',
            caseSensitive: false,
          },
        ],
      },
    });
    expect(effectiveGlossary(glossary, 'main.test')).toEqual([
      { term: 'API', mode: 'keep', caseSensitive: true },
    ]);
  });
});

describe('glossary cache keys', () => {
  const markup = 'Learn React state and hooks in the browser.';

  test('changing an effective entry that appears in markup changes makeCacheKey', async () => {
    const before = effectiveGlossary(
      normalizeGlossary({
        useDefaults: false,
        global: [],
        sites: {},
      }),
      'docs.example.com',
    );
    const after = effectiveGlossary(
      normalizeGlossary({
        useDefaults: false,
        global: [{ term: 'state', mode: 'keep', caseSensitive: false }],
        sites: {},
      }),
      'docs.example.com',
    );
    const base = {
      markup,
      targetLang: 'ko',
      promptVersion: PROMPT_VERSION,
    };
    expect(await makeCacheKey({ ...base, glossary: before })).not.toBe(
      await makeCacheKey({ ...base, glossary: after }),
    );
  });

  test('toggling useDefaults does not change keys when defaults never appear in markup', async () => {
    const withoutDefaults = effectiveGlossary(emptyGlossary(), 'example.com');
    const withDefaults = effectiveGlossary(
      { ...emptyGlossary(), useDefaults: true },
      'example.com',
    );
    const base = {
      markup: '순수 한국어 문장만 있습니다.',
      targetLang: 'ko',
      promptVersion: PROMPT_VERSION,
    };
    expect(await makeCacheKey({ ...base, glossary: withoutDefaults })).toBe(
      await makeCacheKey({ ...base, glossary: withDefaults }),
    );
  });

  test('site override changes key only for matching hostname glossary', async () => {
    const shared = normalizeGlossary({
      useDefaults: false,
      global: [
        { term: 'render', mode: 'map', target: '그리기', caseSensitive: false },
      ],
      sites: {
        'docs.example.com': [
          { term: 'render', mode: 'keep', caseSensitive: false },
        ],
      },
    });
    const base = {
      markup: 'The render pass runs twice.',
      targetLang: 'ko',
      promptVersion: PROMPT_VERSION,
    };
    const docs = effectiveGlossary(shared, 'docs.example.com');
    const other = effectiveGlossary(shared, 'other.example.com');
    expect(await makeCacheKey({ ...base, glossary: docs })).not.toBe(
      await makeCacheKey({ ...base, glossary: other }),
    );
  });
});
