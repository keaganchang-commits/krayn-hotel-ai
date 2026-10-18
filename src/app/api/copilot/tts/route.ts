import { NextResponse } from 'next/server';

export async function POST(request: Request) {
  try {
    const { text, speaker } = await request.json();

    if (!text) {
      return NextResponse.json({ error: 'Text required' }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      return NextResponse.json({ error: 'GEMINI_API_KEY not configured' }, { status: 500 });
    }

    // Assign natural voices like Voice Training page:
    // 'Charon' is the deep, calm, professional male concierge voice
    // 'Aoede' (or 'Kore') is the warm, natural female voice
    const voiceName = speaker === 'caller' ? 'Aoede' : 'Charon';

    // Direct Gemini TTS model for natural cadence & intonation when Priya Sharma speaks
    const speechPromptText = speaker === 'caller'
      ? `Speak naturally in a polite, conversational Malaysian / Singaporean English accent with authentic local intonation and pacing: "${text}"`
      : text;

    const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${apiKey}`;

    const payload = {
      contents: [{
        parts: [{ text: speechPromptText }]
      }],
      generationConfig: {
        responseModalities: ['AUDIO'],
        speechConfig: {
          voiceConfig: {
            prebuiltVoiceConfig: {
              voiceName
            }
          }
        }
      }
    };

    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errText = await res.text();
      console.error('Gemini TTS error response:', errText);
      return NextResponse.json({ error: 'TTS request failed', details: errText }, { status: res.status });
    }

    const data = await res.json();
    const candidate = data.candidates?.[0]?.content?.parts?.[0];
    const base64Audio = candidate?.inlineData?.data;
    const mimeType = candidate?.inlineData?.mimeType || 'audio/L16;codec=pcm;rate=24000';

    if (!base64Audio) {
      return NextResponse.json({ error: 'No audio returned from Gemini' }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      audioBase64: base64Audio,
      mimeType,
      voiceName,
      speaker
    });
  } catch (error: any) {
    console.error('TTS API error:', error);
    return NextResponse.json({ error: error.message || 'TTS failed' }, { status: 500 });
  }
}
