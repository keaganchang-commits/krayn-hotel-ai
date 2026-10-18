import { GoogleGenAI } from '@google/genai';

// Active generative models in order of instant sub-second response:
export const GEMINI_GENERATIVE_MODELS = [
  'gemini-3.1-flash-lite',
  'gemini-3.5-flash-lite',
  'gemini-flash-lite-latest',
  'gemini-3.8-flash',
];

// Initialize Gemini client lazily or with fallback
export function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    console.warn("GEMINI_API_KEY is not set in environment variables. Falling back to mock embeddings/responses.");
    return null;
  }
  return new GoogleGenAI({ apiKey });
}

const embeddingCache = new Map<string, number[]>();
let hasLoggedEmbeddingQuotaError = false;

/**
 * Generate 768-dimensional vector embedding for text chunks with in-memory caching and graceful 429 quota fallback
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  const cacheKey = text.trim();
  if (embeddingCache.has(cacheKey)) {
    return embeddingCache.get(cacheKey)!;
  }

  try {
    const ai = getGeminiClient();
    if (!ai) {
      const mock = createMockEmbedding(text);
      embeddingCache.set(cacheKey, mock);
      return mock;
    }

    const response = await ai.models.embedContent({
      model: 'gemini-embedding-001',
      contents: text,
    });

    if (response.embeddings && response.embeddings.length > 0 && response.embeddings[0].values) {
      const vec = response.embeddings[0].values;
      embeddingCache.set(cacheKey, vec);
      return vec;
    }

    const mock = createMockEmbedding(text);
    embeddingCache.set(cacheKey, mock);
    return mock;
  } catch (error: any) {
    const is429 = error?.status === 429 || String(error?.message || '').includes('429') || String(error?.message || '').includes('RESOURCE_EXHAUSTED');
    if (is429) {
      if (!hasLoggedEmbeddingQuotaError) {
        console.warn('[Gemini Embedding] Daily free-tier rate limit (1,000 requests/day) reached. Gracefully falling back to fast local embeddings.');
        hasLoggedEmbeddingQuotaError = true;
      }
    } else {
      console.error("Error generating Gemini embedding:", error);
    }
    const mock = createMockEmbedding(text);
    embeddingCache.set(cacheKey, mock);
    return mock;
  }
}

/**
 * Fallback embedding generator for testing without an API key
 */
function createMockEmbedding(text: string): number[] {
  const embedding = new Array(768).fill(0);
  for (let i = 0; i < text.length; i++) {
    const charCode = text.charCodeAt(i);
    embedding[i % 768] = (embedding[i % 768] + charCode / 255) % 1;
  }
  return embedding;
}
