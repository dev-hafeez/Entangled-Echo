import fs from 'fs';
import path from 'path';
import { config } from '../config.js';

export const ROMAN_URDU_LEXICON = [
  'kya', 'hai', 'hain', 'nahi', 'nahin', 'main', 'mein', 'kar', 'raha', 'rahe',
  'rahi', 'bhai', 'shukriya', 'aap', 'hum', 'aur', 'acha', 'achha', 'bohot', 'bohat',
  'dekho', 'ye', 'yeh', 'wo', 'woh', 'hota', 'hoti', 'hote', 'gaya', 'gayi',
  'diya', 'paas', 'zindagi', 'dost', 'sab', 'karo', 'karna', 'bhi', 'ka', 'ki',
  'ke', 'ko', 'se', 'yaar', 'abhi', 'matlab', 'waise', 'pyar', 'dil', 'kuch',
  'waqt', 'baat', 'apna', 'apni', 'mujhe', 'tujhe', 'unka', 'inka', 'sirf', 'lekin'
];

export const PORTUGUESE_LEXICON = [
  'obrigado', 'obrigada', 'olá', 'mais', 'uma', 'como', 'isso', 'pelo', 'pela',
  'que', 'não', 'muito', 'ainda', 'sempre', 'novo', 'nova', 'amor', 'vamos',
  'passo', 'dado', 'nacional', 'mim', 'palavras', 'capitão', 'todos', 'tudo',
  'jogo', 'vitória', 'parabéns', 'treino', 'foco', 'grande', 'equipa', 'juntos',
  'agora', 'família', 'história', 'estará', 'portugal'
];

export const STOPWORDS = new Set([
  'the', 'and', 'to', 'of', 'in', 'for', 'is', 'on', 'that', 'by', 'this', 'with',
  'not', 'are', 'from', 'your', 'all', 'have', 'new', 'more', 'an', 'at', 'or',
  'as', 'be', 'it', 'you', 'we', 'our', 'my', 'me', 'us', 'so', 'if', 'can', 'will'
]);

export interface CreatorProfile {
  handle: string;
  niche: string;
  sub_niche: string;
  content_pillars: string[];
  keywords: string[];
  dominantLanguage: string;
  languageConfidence: number;
  captionEmbedding: number[];
  recentTopics: string[];
  hashtagHabits: string[];
  hasHistory: boolean;
  styleExamples: string[];
  postsAnalyzed: number;
  rawCaptions: string[];
}

export const EMBEDDING_DIM = 1024;

// Deterministic 32-bit hash (FNV-1a)
function hashString(str: string): number {
  let hash = 2166136261;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

// Fixed-dimension continuous embedding using word tokens + subword character 3-grams
export function computeTextEmbedding(text: string, dim: number = EMBEDDING_DIM): number[] {
  const vec = new Float64Array(dim);
  if (!text || text.trim().length === 0) {
    return Array.from(vec);
  }

  const clean = text.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ');
  const tokens = clean.split(/\s+/).filter((t) => t.length >= 2 && !STOPWORDS.has(t));

  for (const token of tokens) {
    // 1. Word token unigram (higher weight)
    const wordHash = hashString(token);
    const wordIdx = (wordHash >>> 1) % dim;
    vec[wordIdx] += 2.0;

    // 2. Character 3-grams for root morphology across languages
    if (token.length >= 4) {
      for (let i = 0; i <= token.length - 3; i++) {
        const sub = token.slice(i, i + 3);
        const subHash = hashString(sub);
        const subIdx = (subHash >>> 1) % dim;
        vec[subIdx] += 0.4;
      }
    }
  }

  // L2 normalize
  let sumSq = 0;
  for (let i = 0; i < dim; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq);
  if (norm > 0) {
    for (let i = 0; i < dim; i++) {
      vec[i] /= norm;
    }
  }

  return Array.from(vec);
}

// Cosine similarity between two normalized vectors
export function cosineSimilarity(v1: number[], v2: number[]): number {
  if (!v1 || !v2 || v1.length !== v2.length) return 0;
  let dot = 0;
  for (let i = 0; i < v1.length; i++) {
    dot += v1[i] * v2[i];
  }
  return Math.max(0, Math.min(1, dot));
}

// Script and lexicon based language detection
export function detectCreatorLanguage(
  captions: string[],
  bioText: string = '',
  declaredLanguage: string = ''
): { dominantLanguage: string; confidence: number } {
  const combinedCaptions = captions.join('\n');
  const allText = `${combinedCaptions}\n${bioText}`;
  const lowerText = allText.toLowerCase();

  const totalChars = Math.max(1, allText.trim().length);
  const words = lowerText.replace(/[^\p{L}\s]/gu, ' ').split(/\s+/).filter(Boolean);
  const totalWords = Math.max(1, words.length);

  // 1. Script checks for non-Latin scripts
  const urduArabicMatches = allText.match(/[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/g) || [];
  const devanagariMatches = allText.match(/[\u0900-\u097F]/g) || [];

  const arabicCharRatio = urduArabicMatches.length / totalChars;
  const bioArabicMatches = bioText.match(/[\u0600-\u06FF]/g) || [];
  const bioIsArabic = bioText.trim().length > 0 && (bioArabicMatches.length / Math.max(1, bioText.trim().length)) > 0.35;

  // 2. Lexicon matches
  const romanUrduSet = new Set(ROMAN_URDU_LEXICON);
  const ptSet = new Set(PORTUGUESE_LEXICON);
  const ptAccentsRegex = /[çãõáéíóúâêôà]/gi;

  let romanUrduHits = 0;
  let ptHits = 0;
  const ptAccentHits = (lowerText.match(ptAccentsRegex) || []).length;

  for (const w of words) {
    if (romanUrduSet.has(w)) romanUrduHits++;
    if (ptSet.has(w)) ptHits++;
  }

  const romanUrduRatio = romanUrduHits / totalWords;
  const ptRatio = (ptHits + ptAccentHits) / totalWords;

  // Check Roman Urdu
  if (romanUrduHits >= 3 && romanUrduRatio >= 0.02) {
    return { dominantLanguage: 'Urdu', confidence: Math.min(0.95, Number((0.65 + romanUrduRatio * 3).toFixed(2))) };
  }

  // Check Urdu script (either significant proportion in captions, or bio is pure Urdu while posts are sparse)
  if (arabicCharRatio >= 0.10 || (bioIsArabic && captions.length <= 5)) {
    return { dominantLanguage: 'Urdu', confidence: 0.95 };
  }
  if (devanagariMatches.length / totalChars >= 0.10) {
    return { dominantLanguage: 'Hindi', confidence: 0.95 };
  }

  // Check Portuguese (vocabulary or diacritics)
  const isDeclPt = declaredLanguage.toLowerCase().includes('portuguese');
  if (ptHits >= 2 || ptAccentHits >= 3 || (isDeclPt && (ptHits >= 1 || ptAccentHits >= 1))) {
    const conf = Math.min(0.95, Number((0.70 + ptRatio * 2).toFixed(2)));
    return { dominantLanguage: 'Portuguese', confidence: conf };
  }

  // Check Urdu from bio or declared
  if (bioArabicMatches.length >= 5 || declaredLanguage.toLowerCase().includes('urdu')) {
    return { dominantLanguage: 'Urdu', confidence: 0.85 };
  }

  // Declared preference fallback
  if (declaredLanguage && declaredLanguage !== 'English') {
    const norm = declaredLanguage.toLowerCase();
    if (norm.includes('portuguese')) return { dominantLanguage: 'Portuguese', confidence: 0.70 };
    if (norm.includes('urdu')) return { dominantLanguage: 'Urdu', confidence: 0.70 };
    if (norm.includes('spanish')) return { dominantLanguage: 'Spanish', confidence: 0.70 };
  }

  // Default to English
  const conf = captions.length > 0 ? 0.85 : 0.50;
  return { dominantLanguage: 'English', confidence: conf };
}

// Extract recent topics from the last 20 posts
export function extractRecentTopics(captions: string[]): string[] {
  const recent = captions.slice(0, 20);
  const topicCounts = new Map<string, number>();

  for (const cap of recent) {
    // Strip URLs, handles, and hashtags
    const clean = cap
      .replace(/https?:\/\/\S+/g, '')
      .replace(/@\w+/g, '')
      .replace(/#\w+/g, '')
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ');

    const tokens = clean.split(/\s+/).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
    for (const t of tokens) {
      topicCounts.set(t, (topicCounts.get(t) || 0) + 1);
    }
  }

  return Array.from(topicCounts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([term]) => term);
}

// Extract hashtag habits from posts
export function extractHashtagHabits(posts: any[]): string[] {
  const counts = new Map<string, number>();
  for (const p of posts) {
    const tags: string[] = Array.isArray(p.hashtags) ? p.hashtags : [];
    for (const raw of tags) {
      const tag = raw.toLowerCase().replace(/^#/, '').trim();
      if (tag.length > 0) {
        counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
    // Also parse hashtags directly from caption text if hashtags array was empty
    if (tags.length === 0 && p.caption) {
      const matches = p.caption.match(/#[a-zA-Z0-9_]+/g) || [];
      for (const m of matches) {
        const tag = m.toLowerCase().replace(/^#/, '').trim();
        if (tag.length > 0) counts.set(tag, (counts.get(tag) || 0) + 1);
      }
    }
  }

  return Array.from(counts.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 20)
    .map(([tag]) => tag);
}

// Build creator profile from stored data only
export function buildCreatorProfile(handle: string): CreatorProfile {
  const cleanHandle = handle.toLowerCase().replace(/^@/, '').trim();
  const storageDir = config.localStorageDir;

  const profileFile = path.join(storageDir, 'profiles', `${cleanHandle}.json`);
  const postsFile = path.join(storageDir, 'posts', `${cleanHandle}.json`);
  const nicheFile = path.join(storageDir, 'niches', `${cleanHandle}.json`);

  let profile: any = {};
  let posts: any[] = [];
  let nicheData: any = {};

  if (fs.existsSync(profileFile)) {
    try { profile = JSON.parse(fs.readFileSync(profileFile, 'utf-8')); } catch {}
  }
  if (fs.existsSync(postsFile)) {
    try { posts = JSON.parse(fs.readFileSync(postsFile, 'utf-8')); } catch {}
  }
  if (fs.existsSync(nicheFile)) {
    try { nicheData = JSON.parse(fs.readFileSync(nicheFile, 'utf-8')); } catch {}
  }

  const rawCaptions: string[] = [];
  for (const p of posts) {
    const c = (p.caption || '').trim();
    if (c.length > 0) rawCaptions.push(c);
  }

  const hasHistory = rawCaptions.length > 0;
  const niche = nicheData.niche || profile.niche || 'General Creator';
  const subNiche = nicheData.sub_niche || profile.sub_niche || niche;
  const contentPillars: string[] = Array.isArray(nicheData.content_pillars) && nicheData.content_pillars.length > 0
    ? nicheData.content_pillars
    : ['Core Content', 'Community Highlights', 'Industry Perspectives'];
  const keywords: string[] = Array.isArray(nicheData.keywords) ? nicheData.keywords : [];

  const bio = profile.bio || profile.biography || '';
  const declaredLang = nicheData.language_preference || profile.language_preference || '';
  const langResult = detectCreatorLanguage(rawCaptions, bio, declaredLang);

  // Dominant language confidence is low when hasHistory is false
  const languageConfidence = hasHistory ? langResult.confidence : 0.45;

  // Caption Embedding (Centroid of caption embeddings)
  let captionEmbedding: number[];
  if (hasHistory) {
    const dim = EMBEDDING_DIM;
    const centroid = new Float64Array(dim);
    for (const cap of rawCaptions) {
      const emb = computeTextEmbedding(cap, dim);
      for (let i = 0; i < dim; i++) {
        centroid[i] += emb[i];
      }
    }
    // L2 normalize centroid
    let sumSq = 0;
    for (let i = 0; i < dim; i++) {
      sumSq += centroid[i] * centroid[i];
    }
    const norm = Math.sqrt(sumSq);
    if (norm > 0) {
      for (let i = 0; i < dim; i++) {
        centroid[i] /= norm;
      }
    }
    captionEmbedding = Array.from(centroid);
  } else {
    // If no history, embed declared niche + sub_niche + pillars + keywords
    const declaredContext = `${niche} ${subNiche} ${contentPillars.join(' ')} ${keywords.join(' ')}`;
    captionEmbedding = computeTextEmbedding(declaredContext, EMBEDDING_DIM);
  }

  const recentTopics = extractRecentTopics(rawCaptions);
  const hashtagHabits = extractHashtagHabits(posts);

  // Style examples: 2 to 3 representative captions
  const styleExamples = rawCaptions
    .filter((c) => c.length >= 20 && c.length <= 400)
    .slice(0, 3);

  return {
    handle: cleanHandle,
    niche,
    sub_niche: subNiche,
    content_pillars: contentPillars,
    keywords,
    dominantLanguage: langResult.dominantLanguage,
    languageConfidence,
    captionEmbedding,
    recentTopics,
    hashtagHabits,
    hasHistory,
    styleExamples: styleExamples.length > 0 ? styleExamples : rawCaptions.slice(0, 3),
    postsAnalyzed: rawCaptions.length,
    rawCaptions,
  };
}
