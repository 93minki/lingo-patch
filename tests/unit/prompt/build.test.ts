import { expect, test } from 'vitest';
import {
  buildSystemPrompt,
  buildUserPayload,
  OUTPUT_SCHEMA,
  parseOutput,
} from '../../../src/core/prompt/build';

test('system prompt stays constant and includes fidelity, placeholders and Korean style', () => {
  const prompt = buildSystemPrompt('ko');
  expect(prompt).toBe(buildSystemPrompt('en'));
  for (const rule of [
    'Do not summarize',
    '<xN/>',
    '<gN>',
    '~합니다/~하세요',
    'CLI',
    'keep',
    'map',
    'JSON',
  ])
    expect(prompt).toContain(rule);
  expect(() => buildSystemPrompt('')).toThrow();
});
test('payload includes variable fields but never signal or credentials', () => {
  const req = {
    items: [{ id: '0', text: 'text' }],
    targetLang: 'ko',
    sourceLang: 'en',
    context: { pageTitle: 'Page' },
    glossary: [],
    signal: new AbortController().signal,
  };
  expect(JSON.parse(buildUserPayload(req))).toEqual({
    items: req.items,
    targetLang: 'ko',
    sourceLang: 'en',
    context: req.context,
    glossary: [],
  });
  expect(OUTPUT_SCHEMA.additionalProperties).toBe(false);
});
test('parses fenced JSON, allows missing items and preserves text verbatim', () => {
  expect(
    parseOutput('```json\n{"items":[{"id":"0","text":" <x0/> "}]}\n```', [
      '0',
      '1',
    ]),
  ).toEqual([{ id: '0', text: ' <x0/> ' }]);
  expect(parseOutput('{"items":[]}', ['0'])).toEqual([]);
});
test.each([
  'no json',
  '[]',
  'null',
  '{"items":{}}',
  '{"items":[{"id":"extra","text":"x"}]}',
  '{"items":[{"id":"0","text":1}]}',
  '{"items":[{"id":"0","text":"x"},{"id":"0","text":"y"}]}',
  '{"items":[],"extra":true}',
])('rejects invalid output: %s', (raw) => {
  expect(() => parseOutput(raw, ['0'])).toThrowError(
    expect.objectContaining({ kind: 'invalid_response' }),
  );
});
