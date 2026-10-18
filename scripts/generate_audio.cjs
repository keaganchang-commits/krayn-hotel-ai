const fs = require('fs');
const path = require('path');

const key = process.env.GEMINI_API_KEY || '';

const dialogue = [
  {
    index: 0,
    voice: 'Aoede',
    text: 'Speak naturally in a polite, conversational Malaysian / Singaporean English accent with authentic local intonation and pacing: "Hi, good afternoon! I’d like to book a 60-minute massage at the spa for tomorrow at 3 PM. Do you have slots open?"'
  },
  {
    index: 1,
    voice: 'Charon',
    text: 'Good afternoon, Ms. Sharma. Let me check... uhm, yes, our signature deep massage is available with our senior therapist.'
  },
  {
    index: 2,
    voice: 'Aoede',
    text: 'Speak naturally in a polite, conversational Malaysian / Singaporean English accent with authentic local intonation and pacing: "Wonderful, please reserve that for me and charge it to room 1802."'
  },
  {
    index: 3,
    voice: 'Charon',
    text: 'Of course! I’ve booked your 3:00 PM appointment and will send you confirmation on WhatsApp.'
  }
];

function pcmToWav(pcmBuffer, sampleRate = 24000, numChannels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * numChannels * (bitsPerSample / 8);
  const blockAlign = numChannels * (bitsPerSample / 8);
  const dataSize = pcmBuffer.length;
  const buffer = Buffer.alloc(44 + dataSize);

  buffer.write('RIFF', 0);
  buffer.writeUInt32LE(36 + dataSize, 4);
  buffer.write('WAVE', 8);

  buffer.write('fmt ', 12);
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(numChannels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(byteRate, 28);
  buffer.writeUInt16LE(blockAlign, 32);
  buffer.writeUInt16LE(bitsPerSample, 34);

  buffer.write('data', 36);
  buffer.writeUInt32LE(dataSize, 40);
  pcmBuffer.copy(buffer, 44);

  return buffer;
}

async function generateAll() {
  for (const item of dialogue) {
    console.log(`Generating turn ${item.index}...`);
    try {
      const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-preview-tts:generateContent?key=${key}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: item.text }] }],
          generationConfig: {
            responseModalities: ['AUDIO'],
            speechConfig: {
              voiceConfig: {
                prebuiltVoiceConfig: { voiceName: item.voice }
              }
            }
          }
        })
      });
      const data = await res.json();
      const base64Data = data.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Data) {
        console.error('Failed on item', item.index, data);
        continue;
      }
      const rawPcm = Buffer.from(base64Data, 'base64');
      const wav = pcmToWav(rawPcm, 24000, 1, 16);
      const outPath = path.join(process.cwd(), 'public', 'audio', `turn_${item.index}.wav`);
      fs.writeFileSync(outPath, wav);
      console.log(`Saved ${outPath} (${wav.length} bytes)`);
    } catch (e) {
      console.error(`Error on turn ${item.index}:`, e);
    }
  }
  console.log('ALL TURNS GENERATED!');
}

generateAll();
