import { queryRAGAnswer } from '../src/lib/ai/rag';

async function testRAGEngine() {
  console.log('--- Testing Gemini RAG & Source Citation Engine ---');

  const query = 'Welcome to Google Cloud';
  console.log(`Querying RAG: "${query}"`);

  const response = await queryRAGAnswer(query);

  console.log('\n--- RAG Response ---');
  console.log(`Answer: ${response.answer}`);
  console.log(`Confidence Score: ${response.confidenceScore}%`);
  console.log(`Is Uncertain (<80%): ${response.isUncertain}`);
  console.log(`Citations Count: ${response.citations.length}`);

  response.citations.forEach((c, i) => {
    console.log(`\n[Citation ${i + 1}] Source: ${c.source} (${c.title})`);
    console.log(`Snippet: ${c.snippet.slice(0, 100)}...`);
  });
}

testRAGEngine().catch(console.error);
