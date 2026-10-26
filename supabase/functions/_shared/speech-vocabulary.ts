export function transcriptionKeyterms(vocabulary: unknown): string[] {
  const terms: string[] = [];
  const seen = new Set<string>();
  const encoder = new TextEncoder();
  let bytes = 0;
  // Match the independent candidate app's bounded recognition-hint policy.
  for (const value of ['Truveil', ...(Array.isArray(vocabulary) ? vocabulary.slice(0, 100) : [])]) {
    if (typeof value !== 'string') continue;
    const term = value.normalize('NFC').replace(/\s+/g, ' ').trim();
    const key = term.toLowerCase();
    const size = encoder.encode(term).length + 1;
    if (!term || term.length > 80 || /[\u0000-\u001f\u007f]/.test(term) || seen.has(key) || bytes + size > 320) continue;
    terms.push(term);
    seen.add(key);
    bytes += size;
    if (terms.length === 30) break;
  }
  return terms;
}

export function deepgramVocabularyUrl(base: string, vocabulary: unknown): string {
  const url = new URL(base);
  for (const term of transcriptionKeyterms(vocabulary)) url.searchParams.append('keyterm', term);
  return url.toString();
}

export function spellingPrompt(vocabulary: unknown): string {
  let prompt = 'Names and terms:';
  const encoder = new TextEncoder();
  for (const term of transcriptionKeyterms(vocabulary)) {
    const next = `${prompt} ${term},`;
    if (encoder.encode(next).length <= 200) prompt = next;
  }
  return prompt.slice(0, -1);
}
