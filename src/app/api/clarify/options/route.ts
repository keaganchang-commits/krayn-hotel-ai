import { NextResponse } from 'next/server';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';

export async function POST(request: Request) {
  try {
    const { question, currentOptions } = await request.json();

    if (!question || typeof question !== 'string') {
      return NextResponse.json({ success: false, error: 'Question is required' }, { status: 400 });
    }

    // 1. Retrieve any existing knowledge passages matching the question from vector store
    const relevantChunks = await vectorStore.query(question, 4);
    const knowledgeContext = relevantChunks
      .map(c => `[${c.item.source.toUpperCase()}: ${c.item.title}]\n${c.item.text}`)
      .join('\n\n');

    const ai = getGeminiClient();

    if (!ai) {
      const fallbackOptions = (currentOptions && currentOptions.length > 0)
        ? currentOptions.slice(0, 3)
        : ['Yes, proceed with standard terms', 'No, decline / request more details', 'Escalate to human manager'];
      return NextResponse.json({ success: true, options: fallbackOptions });
    }

    const prompt = `You are Krayn AI, a smart business decision assistant.
Given the company's currently available knowledge base context below, generate up to 3 smart, specific, realistic decision options for the following question.

Knowledge Base Context:
${knowledgeContext || 'No stored company data yet.'}

Question:
"${question}"

Existing/Proposed choices (if any):
${(currentOptions || []).join(' | ')}

Instructions:
1. Provide MAXIMUM 3 concise, clear, and distinct decision choices.
2. Ground the choices in the company's existing knowledge, rules, or typical business best practices.
3. Return strictly a JSON array of up to 3 strings, e.g. ["Option 1", "Option 2", "Option 3"]. Do not include markdown codeblocks or other text.`;

    const modelsToTry = GEMINI_GENERATIVE_MODELS;
    let generatedOptions: string[] | null = null;

    for (const model of modelsToTry) {
      try {
        const response = await ai.models.generateContent({
          model,
          contents: prompt,
        });

        const text = response.text?.trim() || '';
        const jsonMatch = text.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            generatedOptions = parsed.slice(0, 3).map((opt: any) => String(opt).trim());
            break;
          }
        }
      } catch (e) {
        console.warn(`[Smart Options] Model ${model} failed, trying fallback...`);
      }
    }

    const finalOptions: string[] = (generatedOptions && generatedOptions.length > 0)
      ? generatedOptions.slice(0, 3)
      : (currentOptions && currentOptions.length > 0)
        ? currentOptions.slice(0, 3)
        : ['Standard Policy (Default)', 'Custom Approval Required', 'Decline Inquiry'];

    return NextResponse.json({
      success: true,
      options: finalOptions.slice(0, 3),
    });
  } catch (error: any) {
    console.error('Failed to generate smart options:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Error generating smart options' },
      { status: 500 }
    );
  }
}
