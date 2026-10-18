import { NextResponse } from 'next/server';
import { listBusinessAssets, saveBusinessAsset, deleteBusinessAsset, updateBusinessAsset } from '@/lib/assets/storage';
import { processPdfDocument } from '@/lib/documents/pdf';
import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';

// GET /api/assets - List all uploaded business assets
export async function GET() {
  try {
    const assets = listBusinessAssets();
    return NextResponse.json({
      success: true,
      assets,
    });
  } catch (error: any) {
    console.error('Assets GET error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to list assets' },
      { status: 500 }
    );
  }
}

// POST /api/assets - Upload a new business asset (PDF or image) with auto-description & dual-indexing
export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    let userDescription = (formData.get('description') as string | null) || '';
    const relatedQuestion = (formData.get('question') as string | null) || '';

    if (!file) {
      return NextResponse.json(
        { success: false, error: 'No file provided.' },
        { status: 400 }
      );
    }

    const allowedMimePrefixes = ['image/', 'application/pdf'];
    const isPdf = file.name.endsWith('.pdf') || file.type === 'application/pdf';
    const isAllowed = allowedMimePrefixes.some(p => file.type.startsWith(p)) || isPdf;

    if (!isAllowed) {
      return NextResponse.json(
        { success: false, error: 'File must be an image (PNG, JPG, WEBP) or a PDF document.' },
        { status: 400 }
      );
    }

    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Initial asset save
    let asset = saveBusinessAsset(buffer, file.name, file.type, userDescription || file.name);

    // 1. Mandatory Customer-Sharing Clarification Question:
    // Every uploaded document/image immediately registers a clarification question
    // to explicitly confirm if/when this asset may be shared as a customer attachment.
    try {
      const { vectorStore } = await import('@/lib/vector/store');
      const docName = userDescription || file.name;
      const followUpQuestionText = `Can "${docName}" be shared directly with customers when relevant inquiries are received?`;
      
      await vectorStore.addChunk({
        text: `PROACTIVE CLARIFICATION NEEDED for Customer Sharing: ${followUpQuestionText}`,
        source: 'clarification',
        title: 'Customer Sharing Permissions',
        timestamp: new Date().toISOString(),
        metadata: {
          question: followUpQuestionText,
          inputType: 'boolean',
          options: ['Yes', 'No'],
          priorityScore: 95,
          allowMultiple: false,
          assetId: asset.id,
          fileName: asset.name,
          sourceType: 'asset_sharing_verification',
        },
      });
    } catch (followUpErr) {
      console.warn('Error creating asset customer-sharing follow-up question:', followUpErr);
    }

    // 2. Asynchronous Deep Indexing & Understanding (runs in background without blocking upload HTTP response):
    (async () => {
      let extractedFactsCount = 0;
      try {
        if (isPdf) {
          try {
            const pdfSyncResult = await processPdfDocument(buffer, file.name, asset.id);
            extractedFactsCount = pdfSyncResult.syncedCount || 0;
            updateBusinessAsset(asset.id, { extractedFactsCount });
          } catch (pdfErr) {
            console.warn('PDF background extraction error:', pdfErr);
          }
        }

        const ai = getGeminiClient();
        if (ai) {
          let contentParts: any[] = [];
          const isImage = file.type.startsWith('image/');
          if (isImage) {
            contentParts.push({
              inlineData: {
                data: buffer.toString('base64'),
                mimeType: file.type,
              },
            });
          }

          const systemAnalysisPrompt = `You are Krayn AI, an intelligent operations intelligence auditor.
Analyze this newly uploaded business material (PDF or Image).
File Name: "${file.name}"
MIME Type: "${file.type}"
${relatedQuestion ? `Related Clarification Context: "${relatedQuestion}"` : ''}

Your tasks:
1. UNDERSTAND WHAT IT IS: Identify the exact document type (e.g. "Restaurant Dinner Menu", "Room Rate Card", "Floor Plan", "Spa Treatment Price List", "Cancellation & Refund Policy", "Storefront Photo").
2. DETERMINE ITS BUSINESS PURPOSE: What is this material created for? (e.g. "Displays à la carte dining offerings and drink prices for hotel guests").
3. WHEN IT SHOULD BE SHARED: Exactly when should the AI attach this file to an email reply to a customer? (e.g. "Attach when customer inquires about dining options, evening dinner menus, vegetarian choices, or food prices").
4. RELEVANT TOPICS: List 3 to 6 trigger topic keywords (e.g. ["dining", "menu", "dinner", "food", "prices"]).
5. EXTRACT ATOMIC FACTS (if image contains readable prices, opening hours, or offerings): Extract 1 to 5 concise facts as "Topic: Detail".

Return STRICTLY JSON:
{
  "documentType": "Short descriptive title",
  "purpose": "What this material is for",
  "whenToShare": "Explicit conditions and customer inquiries that trigger attaching this file",
  "relevantTopics": ["topic1", "topic2", "topic3"],
  "extractedFacts": [
    { "topic": "Example Topic", "detail": "Specific concise detail" }
  ]
}`;

          contentParts.push({ text: systemAnalysisPrompt });

          const modelsToTry = GEMINI_GENERATIVE_MODELS;
          for (const model of modelsToTry) {
            try {
              const aiRes = await ai.models.generateContent({
                model,
                contents: [{ role: 'user', parts: contentParts }],
              });

              const text = aiRes.text?.trim() || '';
              const match = text.match(/\{[\s\S]*\}/);
              if (match) {
                const analysis = JSON.parse(match[0]);
                
                updateBusinessAsset(asset.id, {
                  description: analysis.documentType || userDescription || file.name,
                  purpose: analysis.purpose,
                  whenToShare: analysis.whenToShare,
                  relevantTopics: Array.isArray(analysis.relevantTopics) ? analysis.relevantTopics : [],
                  extractedFactsCount,
                });

                if (isImage && Array.isArray(analysis.extractedFacts) && analysis.extractedFacts.length > 0) {
                  const { vectorStore } = await import('@/lib/vector/store');
                  const existingItems = await vectorStore.listItems();

                  for (const fact of analysis.extractedFacts) {
                    if (fact.topic && fact.detail) {
                      const normTopic = fact.topic.trim().toLowerCase();
                      const existingMatch = existingItems.find(ex => {
                        const exTopic = String(ex.metadata?.topic || ex.title || '').trim().toLowerCase();
                        return exTopic === normTopic || (normTopic.length > 5 && exTopic.includes(normTopic));
                      });

                      if (existingMatch) {
                        const existingDetail = String(existingMatch.metadata?.detail || existingMatch.text.replace(/^[^:]+:\s*/, '')).trim();
                        const cleanEx = existingDetail.toLowerCase().replace(/[.\s]+$/, '');
                        const cleanFact = fact.detail.toLowerCase().replace(/[.\s]+$/, '');

                        if (cleanEx === cleanFact || cleanEx.includes(cleanFact)) {
                          extractedFactsCount++;
                          continue;
                        } else if (cleanFact.includes(cleanEx)) {
                          const updatedChunkText = `${existingMatch.title}: ${fact.detail}`;
                          await vectorStore.updateItem(existingMatch.id, updatedChunkText, existingMatch.title, existingMatch.title);
                          existingMatch.text = updatedChunkText;
                          extractedFactsCount++;
                          continue;
                        } else {
                          const mergedDetail = `${existingDetail} • ${fact.detail}`;
                          const updatedChunkText = `${existingMatch.title}: ${mergedDetail}`;
                          await vectorStore.updateItem(existingMatch.id, updatedChunkText, existingMatch.title, existingMatch.title);
                          existingMatch.text = updatedChunkText;
                          extractedFactsCount++;
                          continue;
                        }
                      }

                      const chunkText = `${fact.topic}: ${fact.detail}`;
                      const newId = await vectorStore.addChunk({
                        text: chunkText,
                        source: 'image',
                        title: fact.topic,
                        timestamp: new Date().toISOString(),
                        metadata: {
                          topic: fact.topic,
                          detail: fact.detail,
                          fileName: file.name,
                          assetId: asset.id,
                          uploadedAt: new Date().toISOString(),
                        },
                      });
                      existingItems.push({
                        id: newId,
                        text: chunkText,
                        source: 'image',
                        title: fact.topic,
                        timestamp: new Date().toISOString(),
                        metadata: { topic: fact.topic, detail: fact.detail, assetId: asset.id },
                      });
                      extractedFactsCount++;
                    }
                  }
                  updateBusinessAsset(asset.id, { extractedFactsCount });

                  const { deduplicateKnowledgeHub } = await import('@/lib/knowledge/deduplicator');
                  await deduplicateKnowledgeHub().catch(e => console.warn('Deduplication sweep error:', e));
                }
                break;
              }
            } catch (modelErr) {
              console.warn(`[Asset Background AI Analysis] Model ${model} failed, trying next...`);
            }
          }
        }
      } catch (bgErr) {
        console.warn('[Asset Background Processing Error]:', bgErr);
      } finally {
        // Trigger clarification generator to re-evaluate remaining gaps
        import('@/lib/clarify/pregenerator')
          .then(m => m.runBackgroundClarificationPreGenerator())
          .catch(e => console.warn('Pregenerator trigger after asset upload error:', e));
      }
    })();

    return NextResponse.json({
      success: true,
      asset,
      message: `Uploaded asset "${asset.name}" successfully. Parsing and indexing in background.`,
    });
  } catch (error: any) {
    console.error('Assets POST error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to upload asset' },
      { status: 500 }
    );
  }
}

// DELETE /api/assets?id=ASSET_ID - Delete an asset
export async function DELETE(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const id = searchParams.get('id');

    if (!id) {
      return NextResponse.json(
        { success: false, error: 'Asset ID is required.' },
        { status: 400 }
      );
    }

    const deleted = deleteBusinessAsset(id);
    if (!deleted) {
      return NextResponse.json(
        { success: false, error: 'Asset not found.' },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: 'Asset deleted successfully.',
    });
  } catch (error: any) {
    console.error('Assets DELETE error:', error);
    return NextResponse.json(
      { success: false, error: error.message || 'Failed to delete asset' },
      { status: 500 }
    );
  }
}

// PATCH /api/assets - Update asset purpose, whenToShare, or description
export async function PATCH(request: Request) {
  try {
    const { id, purpose, whenToShare, description, relevantTopics } = await request.json();

    if (!id) {
      return NextResponse.json({ success: false, error: 'Asset ID is required.' }, { status: 400 });
    }

    const updated = updateBusinessAsset(id, {
      ...(purpose !== undefined ? { purpose } : {}),
      ...(whenToShare !== undefined ? { whenToShare } : {}),
      ...(description !== undefined ? { description } : {}),
      ...(relevantTopics !== undefined ? { relevantTopics } : {}),
    });

    if (!updated) {
      return NextResponse.json({ success: false, error: 'Asset not found.' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      asset: updated,
      message: 'Asset updated successfully.',
    });
  } catch (error: any) {
    console.error('Assets PATCH error:', error);
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}

