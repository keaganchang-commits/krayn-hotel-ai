export interface ExtractedFact {
  topic: string;
  detail: string;
}

export interface WritingStyleProfile {
  tone: string; // e.g. "Warm, polished, concise, hospitable"
  greetingPattern: string; // e.g. "Dear Guest," or "Hello [Name],"
  signOffPattern: string; // e.g. "Warm regards,"
  signatureBlock?: string;
  keyPhrasingHabits: string[]; // e.g. ["We are pleased to inform you", "Please let us know if you need anything else"]
  sentenceLength: 'concise' | 'balanced' | 'elaborate';
}

export interface ExtractionResult {
  facts: ExtractedFact[];
  writingStyle?: WritingStyleProfile;
  proactiveQuestions: Array<{
    question: string;
    topic?: string;
    options: string[];
    inputType?: 'options' | 'text' | 'file';
    placeholder?: string;
  }>;
}

import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from './gemini';

/**
 * Extracts concise, direct, atomic facts (Topic + Detail) from incoming content (emails, PDFs, documents)
 * and proactively generates straightforward clarification questions for missing details.
 */
export async function extractKnowledgeFacts(
  content: string,
  sourceType: 'gmail' | 'pdf' | 'document' | 'user_teaching',
  title: string
): Promise<ExtractionResult> {
  const ai = getGeminiClient();

  if (!ai || !content.trim()) {
    return {
      facts: [{ topic: title || 'Fact', detail: content.trim() }],
      proactiveQuestions: [],
    };
  }

  const prompt = `You are Krayn AI Knowledge Extraction Engine.
Analyze the following ${sourceType} content ("${title}") to accomplish two critical business goals:

1. EXHAUSTIVE, COMPLETE KNOWLEDGE EXTRACTION INTO ATOMIC BUSINESS FACTS:
   - Extract ALL substantive business rules, services, offerings, terms, pricing, schedules, room categories, menu items, restrictions, contact details, and operational facts.
   - FOR MENUS & DINING MATERIALS:
     * Extract EVERY single individual dish/beverage exhaustively. DO NOT skip dishes or produce vague summaries!
     * Format "topic" with Specific Item Name and Section Context: e.g. "Chateaubriand (Mains)", "Grilled Cameron Pumpkin (Vegetarian)", "Kalix Löjrom (Starters)", "Cucumber Minty Fizz (Homemade Lemonades)", "NV Charles Heidsieck Brut Reserve (Sparkling Wine)".
     * Format "detail" with full ingredients, preparation, dietary/allergen markers, and exact price: e.g. "MYR 148; Served with Pumpkin Seed Crème, Feta, Ice Plant, Puffed Barley, and Pomegranate; Vegetarian, Gluten-Free".
     * If venue name is known from title (e.g. "Merdeka Grill" or "Park Lounge"), include the venue context.
   - FOR GENERAL HOTEL/BUSINESS DOCUMENTS:
     * "topic": Granular operational focus (e.g., "Dinner Hours", "Check-in Age Requirement", "Valet Parking Fee", "Suite Inventory & Beds").
     * "detail": Direct, factual rule without filler words (e.g., "6:00 PM - 10:30 PM daily", "18 years old", "MYR 60 per vehicle", "27 suites with premium city views").
   - STRICT NEGATIVE CONSTRAINT (NEVER EXTRACT DOCUMENT META-DATA):
     * NEVER extract document metadata or file structure notes!
     * DO NOT extract "Compilation Date", "Document Date", "Document Subject", "Document Title", "Document End Status", "Page X of Y", "Document Author", "Version Number", or notes like "Content concludes on page 17".

2. WRITING STYLE & VOICE ANALYSIS (FOR EMAIL REPLIES):
   - Analyze how the human author writes replies:
     * Tone (e.g. warm, polite, executive, direct, hospitable).
     * Greeting format (e.g. "Dear Guest,", "Hello [Name],", "Good afternoon,").
     * Sign-off format (e.g. "Warm regards,", "Best regards,").
     * Key phrasing habits / vocabulary (e.g. "We are delighted to...", "Please feel free to...", "Should you require further assistance...").
     * Sentence structure (concise vs balanced vs elaborate).

3. PROACTIVE CLARIFICATION GENERATION (UNSTATED / MISSING POLICIES ONLY):
   - Scrutinize the document ONLY for operational policies, booking terms, or restrictions that are unstated (e.g., corkage fee, cake fee, cancellation policy, dress code details, age limits).
   - NEVER ask to upload or attach menus, beverage lists, price cards, or master lists—the user has already uploaded the document!
   - NEVER ask for individual dish prices or ingredient lists if the document is a menu.
   - Generate 0 to 2 proactive clarification questions at most:
     * "inputType":
       - "text": For arbitrary specific business facts (e.g., exact cancellation fee amount, corkage fee MYR). Provide a clear "placeholder".
       - "options": For business decisions or policies (e.g., corkage permitted vs prohibited, reservation requirement). Provide 3 distinct options.
       - NEVER output "inputType": "file" during document extraction.

Content:
${content}

Return ONLY a valid JSON object matching this schema:
{
  "facts": [
    { "topic": "Dish / Item (Section)", "detail": "Ingredients, dietary notes; Price" }
  ],
  "writingStyle": {
    "tone": "Warm, polished, concise, hospitable",
    "greetingPattern": "Dear Guest,",
    "signOffPattern": "Warm regards,",
    "keyPhrasingHabits": ["We are pleased to inform you", "Please let us know if you have any questions"],
    "sentenceLength": "concise" | "balanced" | "elaborate"
  },
  "proactiveQuestions": [
    {
      "topic": "Contextual Topic Name",
      "question": "Clear, direct question for business owner?",
      "inputType": "options" | "text" | "file",
      "placeholder": "e.g., Mon-Fri 9:00 AM - 6:00 PM (for text type)",
      "options": ["Option A", "Option B", "Option C"]
    }
  ]
}`;

  const modelsToTry = GEMINI_GENERATIVE_MODELS;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: prompt,
      });

      const text = response.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (parsed.facts && Array.isArray(parsed.facts)) {
          const isDocumentMetadata = (topic: string, detail: string) => {
            const combined = `${topic} ${detail}`.toLowerCase();
            return (
              combined.includes('compilation date') ||
              combined.includes('document compilation') ||
              combined.includes('document subject') ||
              combined.includes('document end status') ||
              combined.includes('document title') ||
              combined.includes('document author') ||
              combined.includes('concludes on page') ||
              combined.includes('page count') ||
              /^page \d+/i.test(topic) ||
              /^part \d+\/\d+/i.test(topic)
            );
          };

          const cleanFacts: ExtractedFact[] = parsed.facts
            .filter((f: any) => f && (f.topic || f.detail || typeof f === 'string'))
            .map((f: any) => {
              if (typeof f === 'string') {
                return { topic: title || 'Fact', detail: f.trim() };
              }
              return {
                topic: (f.topic || title || 'Fact').trim(),
                detail: (f.detail || '').trim(),
              };
            })
            .filter((f: ExtractedFact) => f.detail.length > 0 && !isDocumentMetadata(f.topic, f.detail));

          return {
            facts: cleanFacts,
            writingStyle: parsed.writingStyle && typeof parsed.writingStyle === 'object' ? parsed.writingStyle : undefined,
            proactiveQuestions: Array.isArray(parsed.proactiveQuestions) ? parsed.proactiveQuestions : [],
          };
        }
      }
    } catch (error) {
      console.warn(`Extraction attempt with ${modelName} failed, trying next model...`);
    }
  }

  // Fallback: If AI parsing fails, NEVER dump raw document walls of text into knowledge base!
  const lines = content
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 5 && l.length < 250 && (l.startsWith('-') || l.startsWith('*') || l.includes(':')));

  const fallbackFacts: ExtractedFact[] = [];
  for (const line of lines.slice(0, 20)) {
    const cleanLine = line.replace(/^[-*•\d.]+\s*/, '').trim();
    const colonIdx = cleanLine.indexOf(':');
    if (colonIdx > 2 && colonIdx < 50) {
      fallbackFacts.push({
        topic: cleanLine.slice(0, colonIdx).trim(),
        detail: cleanLine.slice(colonIdx + 1).trim(),
      });
    }
  }

  return {
    facts: fallbackFacts,
    proactiveQuestions: [],
  };
}
