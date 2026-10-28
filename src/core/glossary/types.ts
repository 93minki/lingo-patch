export interface GlossaryEntry {
  term: string;
  mode: 'keep' | 'map';
  target?: string;
  caseSensitive: boolean;
}
