import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';
import { getMalaysianDateTime } from '@/lib/utils/dateTime';

export async function POST(request: Request) {
  try {
    const reqData = await request.json();
    const prompt = reqData.prompt || reqData.userPrompt || '';
    const mode = reqData.mode || (reqData.taskType === 'polish' ? 'polish' : reqData.contextSender || reqData.recipient ? 'reply' : 'new');
    const contextSubject = reqData.contextSubject || reqData.subject || '';
    const contextSender = reqData.contextSender || reqData.recipient || '';
    const contextSnippet = reqData.contextSnippet || '';
    const currentBody = reqData.currentBody || reqData.existingBody || '';

    const ai = getGeminiClient();
    
    // Retrieve relevant background context from RAG vector store
    const queryText = prompt || contextSubject || currentBody || 'email draft';
    const ragResults = await vectorStore.query(queryText, 3);
    const ragContext = ragResults.map(r => r.item.text).join('\n---\n');

    // Retrieve any learned writing style chunk
    let learnedStyleInstructions = '';
    try {
      const allChunks = await vectorStore.listItems();
      const styleChunk = allChunks.find(i => (i.metadata as any)?.type === 'writing_style' || i.title.includes('Writing Style'));
      if (styleChunk) {
        learnedStyleInstructions = `\nSTRICTLY ADOPT THE FOLLOWING LEARNED BRAND VOICE AND STYLE RULES:\n${styleChunk.text}\nMatch the greeting, tone, phrasing habits, and rhythm.\n`;
      }
    } catch {}

    const SIGN_OFF_TEMPLATE = `Warm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`;

    const malaysianTime = getMalaysianDateTime();

    let systemPrompt = `You represent Park Hyatt Kuala Lumpur directly.
Write concise, warm, straightforward, and kind emails with a luxury hospitality touch.

${malaysianTime.formattedPromptContext}
${learnedStyleInstructions}
TONE RULES:
• Use clear, simple language without unnecessary corporate jargon or long paragraphs.
• Be genuinely kind, gracious, and helpful.
• Keep the body short and direct to the point.

Always conclude the email with this exact sign-off template (or learned signature block if specified):
${SIGN_OFF_TEMPLATE}

Return ONLY the plain text content of the email body without meta commentary or subject line headers unless requested.`;

    let userPrompt = '';
    if (mode === 'polish') {
      userPrompt = `Please refine, format, and polish the following draft email to sound professional and clear:
\n\n"${currentBody}"\n\nInstruction / Notes: ${prompt || 'Improve clarity and tone.'}`;
    } else if (mode === 'reply') {
      userPrompt = `Please write a polite professional email reply.
\nOriginal Email Subject: ${contextSubject || 'N/A'}
Original Sender: ${contextSender || 'N/A'}
Original Message Snippet: ${contextSnippet || 'N/A'}
\nMy Instructions / Key points to include: ${prompt || 'Acknowledge email and reply appropriately.'}
\nRelevant Company/Knowledge context:\n${ragContext}`;
    } else {
      userPrompt = `Please draft a new email.
\nTopic / Instructions: ${prompt || 'Professional outreach'}
\nRelevant Knowledge base context:\n${ragContext}`;
    }

    if (!ai) {
      // Fallback mock response if GEMINI_API_KEY is not set
      const mockDraft = mode === 'reply'
        ? `Hi ${contextSender ? contextSender.split('<')[0].trim() : 'there'},\n\nThank you for reaching out regarding "${contextSubject || 'your email'}".\n\n${prompt ? `Regarding your request: ${prompt}.` : 'I have reviewed your message and will update you shortly.'}\n\n${SIGN_OFF_TEMPLATE}`
        : `Hello,\n\nI am writing to get in touch regarding ${prompt || 'our upcoming discussion'}.\n\nPlease let me know if you have any questions or require further details.\n\n${SIGN_OFF_TEMPLATE}`;

      return NextResponse.json({ success: true, draft: mockDraft });
    }

    let draftText = '';
    const modelsToTry = GEMINI_GENERATIVE_MODELS;

    for (const modelName of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model: modelName,
          contents: [
            { role: 'user', parts: [{ text: `${systemPrompt}\n\n${userPrompt}` }] }
          ],
        });
        if (response.text) {
          draftText = response.text;
          break;
        }
      } catch (e) {
        console.warn(`[AI Draft] Model ${modelName} failed, trying next fallback model...`, e);
      }
    }

    if (!draftText) {
      // Fallback draft if API call hits quota or model unavailable
      draftText = mode === 'reply'
        ? `Hi ${contextSender ? contextSender.split('<')[0].trim() : 'there'},\n\nThank you for reaching out regarding "${contextSubject || 'your email'}".\n\n${prompt ? `Regarding your request: ${prompt}.` : 'I have reviewed your message and will update you shortly.'}\n\n${SIGN_OFF_TEMPLATE}`
        : `Hello,\n\nI am writing to get in touch regarding ${prompt || 'our upcoming discussion'}.\n\nPlease let me know if you have any questions or require further details.\n\n${SIGN_OFF_TEMPLATE}`;
    }

    return NextResponse.json({
      success: true,
      draft: draftText.trim(),
    });

  } catch (error: any) {
    console.error('Error generating AI email draft:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to generate AI email draft' },
      { status: 500 }
    );
  }
}
