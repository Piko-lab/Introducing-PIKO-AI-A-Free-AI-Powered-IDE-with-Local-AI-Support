/** Deterministic local embeddings: no external model or native dependency required.
 *  Uses hashed word unigrams/bigrams plus character trigrams, L2-normalised.
 *  This gives real semantic-ish retrieval for code and prose and works fully offline.
 */
export const EMBEDDING_DIM = 384

const STOPWORDS = new Set([
  'the','a','an','and','or','of','to','in','is','it','this','that','for','on','with','as','by','at','be','are','was','were','from','we','you','i','they','he','she','not','but','if','then','else','so','do','does','did','can','could','should','would','will','may','might','have','has','had','using','use','used','into','about','more','than','when','where','which','what','who','how','why','all','any','each','also','just','very','our','your','their','its',
])

function fnv1a(str: string): number {
  let h = 0x811c9dc5
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return h >>> 0
}

function addVector(vec: Float32Array, key: string, weight: number): void {
  const h = fnv1a(key)
  const idx = h % EMBEDDING_DIM
  const sign = (h & 0x80000000) ? -1 : 1
  vec[idx] += sign * weight
  // second hash reduces collision noise
  const idx2 = fnv1a(key + '#2') % EMBEDDING_DIM
  vec[idx2] += sign * weight * 0.5
}

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .split(/[^a-z0-9_$@#./-]+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 1 && t.length < 64 && !STOPWORDS.has(t))
}

export function embed(text: string): number[] {
  const vec = new Float32Array(EMBEDDING_DIM)
  const lower = text.toLowerCase().slice(0, 12000)
  const tokens = tokenize(lower)
  const freq = new Map<string, number>()
  for (const token of tokens) freq.set(token, (freq.get(token) || 0) + 1)
  for (const [token, count] of freq) {
    const weight = 1 + Math.log(count)
    addVector(vec, 'w:' + token, weight)
    if (token.includes('_') || token.includes('-') || token.includes('.')) {
      for (const piece of token.split(/[_.\-/]/)) {
        if (piece.length > 1) addVector(vec, 'w:' + piece, weight * 0.6)
      }
    }
  }
  for (let i = 0; i < tokens.length - 1; i++) {
    addVector(vec, 'b:' + tokens[i] + '_' + tokens[i + 1], 0.55)
  }
  const compact = lower.replace(/\s+/g, ' ').slice(0, 8000)
  for (let i = 0; i < compact.length - 2; i += 1) {
    addVector(vec, 'c:' + compact.slice(i, i + 3), 0.18)
  }
  let norm = 0
  for (let i = 0; i < EMBEDDING_DIM; i++) norm += vec[i] * vec[i]
  norm = Math.sqrt(norm) || 1
  const out = new Array<number>(EMBEDDING_DIM)
  for (let i = 0; i < EMBEDDING_DIM; i++) out[i] = vec[i] / norm
  return out
}

export function cosine(a: number[], b: number[]): number {
  if (!a?.length || !b?.length) return 0
  const n = Math.min(a.length, b.length)
  let dot = 0
  let na = 0
  let nb = 0
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i]
    na += a[i] * a[i]
    nb += b[i] * b[i]
  }
  if (!na || !nb) return 0
  return dot / (Math.sqrt(na) * Math.sqrt(nb))
}

export function lexicalScore(query: string, text: string): number {
  const qTokens = uniqueTokens(tokenize(query))
  if (!qTokens.length) return 0
  const hay = text.toLowerCase()
  let hits = 0
  for (const token of qTokens) {
    if (hay.includes(token)) {
      hits++
      const occurrences = hay.split(token).length - 1
      hits += Math.min(occurrences, 5) * 0.12
    }
  }
  return hits / qTokens.length
}

function uniqueTokens(tokens: string[]): string[] {
  return [...new Set(tokens)]
}

export interface Chunk {
  content: string
  startLine: number
  endLine: number
  index: number
}

export function chunkText(text: string, options: { maxChars?: number; overlapLines?: number } = {}): Chunk[] {
  const maxChars = options.maxChars ?? 1800
  const overlapLines = options.overlapLines ?? 6
  const lines = text.split(/\r?\n/)
  const chunks: Chunk[] = []
  let start = 0
  let index = 0
  while (start < lines.length) {
    let end = start
    let chars = 0
    while (end < lines.length && (chars < maxChars || end === start)) {
      chars += lines[end].length + 1
      end++
    }
    const content = lines.slice(start, end).join('\n')
    if (content.trim()) {
      chunks.push({ content, startLine: start + 1, endLine: end, index })
      index++
    }
    if (end >= lines.length) break
    start = Math.max(start + 1, end - overlapLines)
  }
  return chunks
}

export function embeddingToJson(vec: number[]): string {
  return JSON.stringify(vec.map((v) => Number(v.toFixed(5))))
}

export function embeddingFromJson(json: string | null | undefined): number[] {
  if (!json) return []
  try {
    const parsed = JSON.parse(json)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function hybridScore(query: string, queryVec: number[], text: string, textVecJson: string | null | undefined): number {
  const vec = embeddingFromJson(textVecJson)
  const sem = vec.length ? cosine(queryVec, vec) : 0
  const lex = lexicalScore(query, text)
  return sem * 0.62 + lex * 0.38
}
