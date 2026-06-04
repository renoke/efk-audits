export type Lang = 'fr' | 'de' | 'en' | 'it';

export const LANG_NAME: Record<Lang, string> = {
  fr: 'French',
  de: 'German',
  en: 'English',
  it: 'Italian',
};

const STOPWORDS: Record<Lang, string[]> = {
  fr: ['le', 'la', 'les', 'des', 'une', 'dans', 'pour', 'que', 'est', 'aux', 'sur', 'par', 'quel', 'quelle', 'comment', 'pourquoi'],
  de: ['der', 'die', 'das', 'und', 'den', 'von', 'mit', 'für', 'auf', 'ist', 'dem', 'nicht', 'was', 'wie', 'warum', 'welche'],
  en: ['the', 'and', 'for', 'that', 'with', 'are', 'this', 'was', 'from', 'has', 'have', 'what', 'how', 'why', 'which'],
  it: ['il', 'la', 'le', 'dei', 'che', 'per', 'con', 'una', 'del', 'nel', 'sono', 'gli', 'quale', 'come', 'perché', 'cosa'],
};

export function detectLanguage(text: string): Lang {
  const tokens = new Set(text.toLowerCase().match(/\p{L}+/gu) ?? []);
  const scores: Record<Lang, number> = { fr: 0, de: 0, en: 0, it: 0 };
  for (const lang of Object.keys(STOPWORDS) as Lang[]) {
    for (const w of STOPWORDS[lang]) if (tokens.has(w)) scores[lang]++;
  }
  let best: Lang = 'en';
  for (const lang of Object.keys(scores) as Lang[]) if (scores[lang] > scores[best]) best = lang;
  return best;
}
