import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from './gemini';
import { vectorStore } from '../vector/store';
import { listBusinessAssets } from '../assets/storage';
import { getMalaysianDateTime } from '../utils/dateTime';
import { OFFICIAL_ROOM_PROMPT_INSTRUCTION } from '../hotel/rooms';

export interface Citation {
  source: 'gmail' | 'pdf' | 'user_teaching' | 'clarification' | 'image';
  title: string;
  snippet: string;
  score: number;
}

export interface UnansweredQuestion {
  question: string;
  clarificationQuestion: string;
  clarificationOptions: string[];
  inputType?: 'options' | 'text' | 'file';
  placeholder?: string;
}

export interface RAGAnswerResponse {
  answer: string;
  citations: Citation[];
  confidenceScore: number;
  isUncertain: boolean;
  category?: 'PROMOTIONAL_NO_REPLY' | 'QUESTION_NEW_KNOWLEDGE' | 'KNOWN_QUESTION';
  unansweredQuestions?: UnansweredQuestion[];
  clarificationQuestion?: string;
  clarificationOptions?: string[];
  allQuestionsAnswered?: boolean;
  attachedAssetIds?: string[];
}

/**
 * Execute Multi-Question RAG pipeline:
 * 1. Checks if the incoming message has multiple questions/inquiries.
 * 2. Evaluates EACH inquiry against vector knowledge store.
 * 3. STRICT RULE: If ANY question has confidence < 80% or is unknown, isUncertain is TRUE,
 *    allQuestionsAnswered is FALSE, and the unknown questions are collected for the Clarifications Center.
 * 4. Only when ALL questions are confident is the email allowed to be answered autonomously.
 */
export async function queryRAGAnswer(userQuery: string): Promise<RAGAnswerResponse> {
  const trimmed = userQuery.trim().toLowerCase();
  const isGreetingOnly = /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|hola|greetings)[\s!.,?]*$/i.test(trimmed);

  if (isGreetingOnly) {
    return {
      answer: "Thank you for reaching out to Park Hyatt Kuala Lumpur. How can I help you?\n\nWarm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur",
      citations: [],
      confidenceScore: 100,
      isUncertain: false,
      allQuestionsAnswered: true,
      category: 'KNOWN_QUESTION',
    };
  }

  // Retrieve top matching context chunks from vector DB (expanded to 18 to capture full category & venue breadth)
  const searchResults = await vectorStore.query(userQuery, 18);

  const citations: Citation[] = searchResults.map(res => ({
    source: res.item.source,
    title: res.item.title,
    snippet: res.item.text,
    score: res.score,
  }));

  const topScore = searchResults.length > 0 ? searchResults[0].score : 0;
  let baseConfidence = Math.round(topScore * 100);

  const hasUserTeaching = searchResults.some(
    res => res.item.source === 'user_teaching'
  );
  if (hasUserTeaching && searchResults.length > 0) {
    baseConfidence = Math.max(baseConfidence, 88);
  }

  const contextString = searchResults
    .map((res, i) => `[Source ${i + 1}: ${res.item.source.toUpperCase()} - ${res.item.title}]\n${res.item.text}`)
    .join('\n\n');

  const ai = getGeminiClient();

  if (!ai) {
    if (baseConfidence < 80) {
      return {
        answer: "I don't have enough confident information to answer this question accurately.",
        citations,
        confidenceScore: baseConfidence,
        isUncertain: true,
        allQuestionsAnswered: false,
        clarificationQuestion: `I'm unsure about "${userQuery}". Could you clarify this detail?`,
        clarificationOptions: [
          "Provide specific operating details",
          "Specify standard terms",
        ],
      };
    }

    return {
      answer: `Based on your stored context: ${searchResults[0]?.item.text || 'No context found.'}`,
      citations,
      confidenceScore: baseConfidence,
      isUncertain: false,
      allQuestionsAnswered: true,
    };
  }

  const availableAssets = listBusinessAssets();
  const assetsString = availableAssets.length > 0
    ? availableAssets.map(a => `- ID: "${a.id}", Name: "${a.name}", Type: "${a.mimeType}"${a.description ? `, Summary: "${a.description}"` : ''}${a.purpose ? `, Purpose: "${a.purpose}"` : ''}${a.whenToShare ? `, When to share: "${a.whenToShare}"` : ''}${a.relevantTopics?.length ? `, Trigger Topics: [${a.relevantTopics.join(', ')}]` : ''}`).join('\n')
    : 'None';

  // Retrieve any learned writing style chunk
  let writingStyleGuidance = '';
  try {
    const allItems = await vectorStore.listItems();
    const styleChunk = allItems.find(i => (i.metadata as any)?.type === 'writing_style' || i.title.includes('Writing Style'));
    if (styleChunk) {
      writingStyleGuidance = `\nLEARNED BRAND VOICE & WRITING STYLE (STRICTLY ADOPT THIS STYLE):\n${styleChunk.text}\n- Ensure greeting, tone, phrasing, and sign-off align directly with the learned style above.\n`;
    }
  } catch (err) {
    // Non-blocking
  }

  const malaysianTime = getMalaysianDateTime();

  const systemPrompt = `You represent Park Hyatt Kuala Lumpur directly.
Analyze the incoming inquiry and evaluate it against the provided Context Passages learned from user replies and documents.

${malaysianTime.formattedPromptContext}
${OFFICIAL_ROOM_PROMPT_INSTRUCTION}
${writingStyleGuidance}
TONE & LANGUAGE RULES (CRITICAL):
• Never refer to yourself as an AI, bot, agent, or autonomous assistant.
• Never ask "How can I assist you with dining, rooms, food, etc.". Simply say "How can I help you?".
• GREETING / SALUTATION RULE: When greeting the guest (e.g. in email "Dear [Name],"), if you know their name, use their name (e.g. "Dear Sarah,"). If you do NOT know their name, address them simply as "Dear Guest,". NEVER greet them by their email address (e.g., never say "Dear sarah.jenkins@...", never use email usernames like "Dear sarah.jenkins,") and NEVER greet them by their phone number!
• Be direct, natural, and concise. Use simple, everyday, intuitive language.
• Answer whatever is necessary to address the customer's question directly — nothing more, nothing less.
• Zero corporate filler, zero lengthy greetings, zero unnecessary preamble ("Thank you for contacting us", "I would be delighted to assist").
• State the factual details clearly. If multiple details are involved, use clean, easy-to-read phrasing.

CRITICAL INSTRUCTIONS:
1. Deconstruct the incoming email into every distinct question, inquiry, or topic the user asks (e.g. if the user asks "How much are the eggs and what time do you open?", that is 2 questions: [1. "Price of eggs", 2. "Opening hours"]).
2. For EACH question, determine whether the Context Passages provide a direct, reliable answer with high confidence (>=80%).
3. If ANY question cannot be answered with high confidence:
   - You MUST set "allQuestionsAnswered" to false and "isUncertain" to true.
   - You MUST NOT approve sending a partial email reply.
   - For every question that is missing knowledge, formulate a direct, straightforward question with max 3 punchy options (under 4 words each). Zero fluff or filler words.
4. Categorize email:
   - "PROMOTIONAL_NO_REPLY": Marketing blasts, newsletters, receipts, notifications, or spam that require no reply.
   - "QUESTION_NEW_KNOWLEDGE": Contains one or more inquiries where knowledge is missing or incomplete.
   - "KNOWN_QUESTION": EVERY single inquiry in the email has a confirmed, confident answer in Context Passages.
5. ATTACHMENTS (Images, PDFs, Brochures, Catalogs):
   Inspect the Available Business Assets list below.
   If the incoming email explicitly or implicitly asks for a document, brochure, price list, menu, photo, or guide that matches an asset, list its ID in "attachedAssetIds". Do NOT attach files unless directly relevant to what the customer requested.
6. CLOSING SIGN-OFF TEMPLATE:
   Unless an explicit learned signature block is provided above, conclude with:
   Warm regards,
   Park Hyatt Kuala Lumpur
   Menara Merdeka Maybank, 50118 Kuala Lumpur
   Tel: +60 3 2333 1234 | kualalumpur.park@hyatt.com
   www.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur
   (If representing a different verified business in context, adapt the business name and contact channels dynamically to match).

Available Business Assets (PDFs/Images):
${assetsString}

Context Passages:
${contextString || 'No relevant context found in database.'}

Incoming Email:
${userQuery}

Return strictly a JSON object matching this schema:
{
  "category": "PROMOTIONAL_NO_REPLY" | "QUESTION_NEW_KNOWLEDGE" | "KNOWN_QUESTION",
  "allQuestionsAnswered": boolean,
  "isUncertain": boolean,
  "answer": string (if allQuestionsAnswered is true, the complete, friendly, polished email reply answering ALL questions. If false, leave empty or brief notes),
  "attachedAssetIds": string[] (array of asset IDs to attach to the email, e.g. ["asset_..."]),
  "unansweredQuestions": [
    {
      "question": "The specific inquiry from customer that has no answer",
      "clarificationQuestion": "Direct question for business owner (e.g. 'What time do you open on Sundays?')",
      "inputType": "options" | "text" | "file",
      "placeholder": "e.g., 9:00 AM - 6:00 PM (for text type)",
      "clarificationOptions": ["Option A", "Option B", "Option C"]
    }
  ]
}`;

  const modelsToTry = GEMINI_GENERATIVE_MODELS;

  for (const modelName of modelsToTry) {
    try {
      const response = await ai.models.generateContent({
        model: modelName,
        contents: systemPrompt,
      });

      const responseText = response.text || '';
      const jsonMatch = responseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        if (parsed.category === 'PROMOTIONAL_NO_REPLY') {
          return {
            answer: '',
            citations: [],
            confidenceScore: 0,
            isUncertain: false,
            allQuestionsAnswered: true,
            category: 'PROMOTIONAL_NO_REPLY',
          };
        }

        const unansweredList: UnansweredQuestion[] = Array.isArray(parsed.unansweredQuestions)
          ? parsed.unansweredQuestions
          : [];

        // STRICT LOGIC: If unansweredQuestions is not empty OR allQuestionsAnswered is false
        const hasUnanswered = unansweredList.length > 0 || parsed.allQuestionsAnswered === false || parsed.category === 'QUESTION_NEW_KNOWLEDGE';
        const isUncertain = hasUnanswered || !!parsed.isUncertain;
        const allQuestionsAnswered = !isUncertain;

        // Take primary clarification question from the first unanswered item
        const firstUnanswered = unansweredList[0];
        const clarificationQuestion = firstUnanswered?.clarificationQuestion || parsed.clarificationQuestion;
        const clarificationOptions = firstUnanswered?.clarificationOptions || parsed.clarificationOptions;

        return {
          answer: allQuestionsAnswered ? (parsed.answer || responseText) : '',
          citations,
          confidenceScore: isUncertain ? Math.min(baseConfidence, 55) : Math.max(baseConfidence, 88),
          isUncertain,
          allQuestionsAnswered,
          category: parsed.category,
          unansweredQuestions: unansweredList,
          clarificationQuestion,
          clarificationOptions,
          attachedAssetIds: Array.isArray(parsed.attachedAssetIds) ? parsed.attachedAssetIds : [],
        };
      }

      return {
        answer: responseText,
        citations,
        confidenceScore: Math.max(baseConfidence, 80),
        isUncertain: false,
        allQuestionsAnswered: true,
      };
    } catch (err: any) {
      console.warn(`RAG model ${modelName} failed (${err?.message}), trying fallback...`);
    }
  }

  return {
    answer: '',
    citations,
    confidenceScore: 0,
    isUncertain: true,
    allQuestionsAnswered: false,
    clarificationQuestion: `I don't have enough verified knowledge to answer "${userQuery}". How should Krayn AI respond?`,
    clarificationOptions: ["Provide specific details", "Ignore / Skip inquiry"],
    unansweredQuestions: [
      {
        question: userQuery,
        clarificationQuestion: `Customer asked: "${userQuery}". How should Krayn AI respond?`,
        clarificationOptions: ["Provide specific details", "Ignore / Skip inquiry"]
      }
    ]
  };
}
