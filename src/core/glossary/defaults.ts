import type { GlossaryEntry } from './types';

export const DEFAULT_GLOSSARY: GlossaryEntry[] = [
  'props',
  'state',
  'hook',
  'callback',
  'component',
  'middleware',
  'render',
  'prop drilling',
  'framework',
  'library',
  'API',
  'DOM',
  'browser',
  'server',
  'client',
  'router',
  'endpoint',
  'runtime',
  'module',
  'bundle',
].map((term) => ({ term, mode: 'keep', caseSensitive: false }));
