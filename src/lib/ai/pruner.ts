import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from './gemini';

export interface PrunedFact {
  id?: string;
  topic: string;
  detail: string;
}

/**
 * Prune and decompose raw text, answers, or documents into atomic, concise Topic & Detail pairs.
 * 
 * Rules:
 * - If an answer has multiple aspects, split them into separate distinct rows.
 * - Zero fluff, zero preamble, zero AI commentary.
 * - Topic must be a short, clean subject (e.g. "Communication style", "Clients", "Method of purchase", "Business type").
 * - Detail must be the exact, concise fact (e.g. "Warm & friendly", "Businesses and consumers", "Online", "Hotel").
 */
export async function pruneToConciseFacts(
  input: {
    question?: string;
    answer?: string;
    rawText?: string;
    fallbackTopic?: string;
  }
): Promise<PrunedFact[]> {
  const { question, answer, rawText, fallbackTopic } = input;
  const contentToPrune = rawText || (question ? `Question: "${question}"\nAnswer: "${answer || ''}"` : (answer || ''));

  if (!contentToPrune.trim()) {
    return [];
  }

  const ai = getGeminiClient();

  if (!ai) {
    // Fallback if Gemini client is unavailable
    if (question && answer) {
      return [{ topic: question.replace(/[?:]/g, '').trim(), detail: answer.trim() }];
    }
    return [{ topic: fallbackTopic || 'Fact', detail: contentToPrune.trim() }];
  }

  const prompt = `You are Krayn AI Knowledge Pruner.
Your task is to prune and condense business knowledge into granular, operationally focused Topic & Detail pairs.

CRITICAL RULES:
1. Deconstruct compound statements: If an answer or statement contains multiple facts or aspects, SPLIT them into separate rows.
2. Topic: Must be a specific, granular operational focus (e.g., "Room Amenities & Beds", "Breakfast & Dining Options", "Check-in & Departure Hours", "Cancellation Policy", "Parking & Transport", "Communication Style", "Primary Client Base").
   - AVOID vague, generic single-word topics like "General", "Clients", or "Basics".
   - Make the topic clearly reflect the operational subject area.
3. Detail: Must be the absolute concise core fact without any filler words (e.g., "Warm & friendly", "Businesses and consumers", "Online bookings", "Full-service boutique hotel", "14-day advance notice", "Check-in 2pm / Check-out 11am").
4. Zero filler phrases, no "Regarding...", no "The confirmed answer is...", no sentences where a concise phrase suffices.

EXAMPLES:
Input:
Question: "What communication style should the AI use in email replies?"
Answer: "Warm & friendly"
Output:
[
  {"topic": "Communication style", "detail": "Warm & friendly"}
]

Input:
Question: "Who are your main clients or customers?"
Answer: "Both businesses & consumers"
Output:
[
  {"topic": "Clients", "detail": "Businesses and consumers"}
]

Input:
Question: "How do customers typically engage or purchase from you?"
Answer: "Online. We are a hotel."
Output:
[
  {"topic": "Method of purchase", "detail": "Online"},
  {"topic": "Business type", "detail": "Hotel"}
]

Input:
Question: "What does your business primarily provide?"
Answer: "Services & Client Work"
Output:
[
  {"topic": "Primary offering", "detail": "Services & Client Work"}
]

NOW PRUNE THIS INPUT:
${contentToPrune}

Return strictly a valid JSON array:
[
  {"topic": "Concise Topic", "detail": "Concise Detail"}
]`;

  const modelsToTry = GEMINI_GENERATIVE_MODELS;

  for (const model of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model,
        contents: prompt,
      });

      const text = response.text?.trim() || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          return parsed
            .filter((p: any) => p && typeof p.topic === 'string' && typeof p.detail === 'string')
            .map((p: any) => ({
              topic: p.topic.trim(),
              detail: p.detail.trim(),
            }));
        }
      }
    } catch (err) {
      console.warn(`[Prune Engine] Model ${model} failed, trying next...`);
    }
  }

  // Graceful fallback if AI parsing fails
  if (question && answer) {
    return [{ topic: question.replace(/[?:]/g, '').trim(), detail: answer.trim() }];
  }
  return [{ topic: fallbackTopic || 'Fact', detail: contentToPrune.trim() }];
}
