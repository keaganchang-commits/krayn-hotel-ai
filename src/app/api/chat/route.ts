import { NextResponse } from 'next/server';
import { vectorStore } from '@/lib/vector/store';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { inferClarificationInputType } from '@/lib/clarify/seedQuestions';

export async function POST(request: Request) {
  try {
    const { question } = await request.json();

    if (!question || typeof question !== 'string' || question.trim().length === 0) {
      return NextResponse.json(
        { success: false, error: 'Question text is required.' },
        { status: 400 }
      );
    }

    const trimmedQuestion = question.trim();

    // 1. Retrieve knowledge from vector store
    const allStoreItems = await vectorStore.listItems();
    const confirmedItems = allStoreItems.filter(item => item.source !== 'clarification');
    const searchResults = await vectorStore.query(trimmedQuestion, 6);

    const relevantChunks = searchResults.filter(r => r.item.source !== 'clarification' && r.score >= 0.55);
    const topScore = relevantChunks.length > 0 ? relevantChunks[0].score : 0;
    const confidenceScore = Math.round(topScore * 100);

    const businessContext = confirmedItems.slice(0, 20).map(c => `- [${c.title}]: ${c.text}`).join('\n');
    const contextPassages = relevantChunks.map(r => `[${r.item.title}]: ${r.item.text}`).join('\n\n');

    const ai = getGeminiClient();

    if (!ai) {
      // Fallback if no AI client
      if (relevantChunks.length > 0) {
        return NextResponse.json({
          success: true,
          status: 'answered',
          answer: relevantChunks[0].item.text,
          confidenceScore,
          citations: relevantChunks.map(c => ({
            source: c.item.source,
            title: c.item.title,
            snippet: c.item.text,
            score: c.score,
          })),
        });
      }

      // Route to clarifications
      const clarificationId = `clarify_chat_${Date.now()}`;
      await vectorStore.addChunk({
        text: `PROACTIVE CLARIFICATION NEEDED for customer inquiry: ${trimmedQuestion}`,
        source: 'clarification',
        title: 'Customer Question',
        timestamp: new Date().toISOString(),
        metadata: {
          question: trimmedQuestion,
          options: ['Provide details', 'Not offered / applicable'],
          inputType: 'text',
          priorityScore: 92,
          sourceType: 'ai_chat',
        },
      });

      return NextResponse.json({
        success: true,
        status: 'unanswered',
        answer: "I don't have this information yet in our verified business records. I've automatically added this to Clarifications so our team can provide the exact details.",
        confidenceScore: 0,
        queuedToClarifications: true,
        clarificationQuestion: trimmedQuestion,
        citations: [],
      });
    }

    // Retrieve uploaded business assets
    const { listBusinessAssets } = await import('@/lib/assets/storage');
    const availableAssets = listBusinessAssets();
    const assetsSummary = availableAssets.map(a => `- Asset ID "${a.id}": "${a.name}" (${a.mimeType}). Purpose: ${a.purpose || a.description || 'General info'}. When to share: ${a.whenToShare || 'When customer asks for it'}. Topics: ${(a.relevantTopics || []).join(', ')}`).join('\n');

    const systemPrompt = `You represent this hotel / business directly as a professional representative.
A customer is messaging you directly.

BUSINESS KNOWLEDGE BASE:
${businessContext || 'No verified knowledge established yet.'}

SPECIFIC PASSAGES RELEVANT TO INQUIRY:
${contextPassages || 'No matching records found in knowledge store.'}

BUSINESS ASSETS & MEDIA AVAILABLE TO SHARE:
${assetsSummary || 'No media or documents uploaded yet.'}

CUSTOMER MESSAGE:
"${trimmedQuestion}"

YOUR TASK & TONE:
• Never refer to yourself as an AI, bot, agent, or autonomous assistant. Speak naturally as a human hotel team member.
• Never ask "How can I assist you with dining, rooms, food, etc.". Simply say "How can I help you?".
• Be direct, natural, and concise. Use simple, everyday, intuitive language.
• Answer strictly whatever is necessary to address the customer's question. Do not add corporate fluff, filler intros ("Thank you for contacting us", "Certainly, I'd be happy to help"), or unnecessary pleasantries.
• If answering multiple items (hours, prices, policies), present them cleanly.

Determine which category applies:
1. "IRRELEVANT": The query is completely unrelated to this business (e.g. general trivia, coding, homework, unrelated topics).
   - If IRRELEVANT: Return a polite, brief 1-sentence note stating this assistant only handles questions about this business.
2. "ANSWERED": The inquiry is relevant, and the business knowledge base contains the factual details.
   - If ANSWERED: Give a clear, direct, and concise answer based strictly on the facts. Simple and intuitive phrasing.
   - If the customer explicitly asks for or would directly benefit from a document or photo (menu, guide, rate card), include the matching asset ID in "relevantAssetIds".
3. "UNANSWERED": The question is legitimate about the business, but the verified knowledge base does NOT contain the exact answer.
   - If UNANSWERED:
     * Reply with a short, polite note stating that you are checking this detail with the team.
     * Formulate a direct, simple question for the business owner to clarify.
     * Provide 2 to 4 short, intuitive options (or leave empty if best answered as free text).
     * Provide a clean topic title (e.g. "Breakfast Hours", "Parking Rates").

Return strictly a JSON object:
{
  "status": "answered" | "irrelevant" | "unanswered",
  "customerReply": "The polite message to the customer",
  "relevantAssetIds": ["asset_id_here"],
  "clarificationQuestion": "Direct question for business owner (only if unanswered)",
  "clarificationTitle": "Short category title (only if unanswered)",
  "clarificationOptions": ["Option 1", "Option 2", "Option 3"] (only if unanswered),
  "inputType": "options" | "text" | "boolean" (only if unanswered)
}`;

    const modelsToTry = GEMINI_GENERATIVE_MODELS;
    let resultJson: any = null;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: systemPrompt,
        });

        const text = response.text || '';
        const match = text.match(/\{[\s\S]*\}/);
        if (match) {
          resultJson = JSON.parse(match[0]);
          break;
        }
      } catch (err: any) {
        console.warn(`Chat model ${modelName} error (${err?.message}), attempting fallback...`);
      }
    }

    if (!resultJson) {
      resultJson = {
        status: relevantChunks.length > 0 ? 'answered' : 'unanswered',
        customerReply: relevantChunks.length > 0 
          ? relevantChunks[0].item.text 
          : "I've routed your inquiry to our team in Clarifications to get you the exact information.",
        clarificationQuestion: trimmedQuestion,
        clarificationTitle: 'Customer Inquiry',
        clarificationOptions: ['Provide details', 'Not offered'],
        inputType: 'text'
      };
    }

    // If UNANSWERED: Store into vectorStore with source: 'clarification' so it immediately shows in the Clarifications Hub
    let queuedToClarifications = false;
    if (resultJson.status === 'unanswered') {
      const qText = resultJson.clarificationQuestion || trimmedQuestion;
      const inferred = inferClarificationInputType(qText, resultJson.inputType);

      await vectorStore.addChunk({
        text: `PROACTIVE CLARIFICATION NEEDED for customer inquiry: ${qText}`,
        source: 'clarification',
        title: resultJson.clarificationTitle || 'Customer Inquiry',
        timestamp: new Date().toISOString(),
        metadata: {
          question: qText,
          options: resultJson.clarificationOptions || [],
          inputType: inferred.inputType || resultJson.inputType || 'options',
          placeholder: inferred.placeholder,
          priorityScore: 95, // High priority since a customer asked it in real-time
          sourceType: 'ai_chat',
          originalCustomerQuery: trimmedQuestion,
        },
      });
      queuedToClarifications = true;
    }

    // Resolve any matched asset objects
    const matchedAssetIds: string[] = Array.isArray(resultJson.relevantAssetIds) ? resultJson.relevantAssetIds : [];
    const attachedAssets = availableAssets.filter(a => matchedAssetIds.includes(a.id)).map(a => ({
      id: a.id,
      name: a.name,
      filename: a.filename,
      mimeType: a.mimeType,
      size: a.size,
      description: a.description,
      purpose: a.purpose,
    }));

    return NextResponse.json({
      success: true,
      status: resultJson.status,
      answer: resultJson.customerReply,
      confidenceScore: resultJson.status === 'answered' ? Math.max(confidenceScore, 85) : (resultJson.status === 'irrelevant' ? 95 : 20),
      queuedToClarifications,
      clarificationQuestion: resultJson.clarificationQuestion,
      attachedAssets,
      citations: relevantChunks.map(c => ({
        source: c.item.source,
        title: c.item.title,
        snippet: c.item.text,
        score: c.score,
      })),
    });
  } catch (error: any) {
    console.error('Chat API error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to process question' },
      { status: 500 }
    );
  }
}
