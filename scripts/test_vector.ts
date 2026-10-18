import { vectorStore } from '../src/lib/vector/store.js';
import { chunkText } from '../src/lib/vector/chunker.js';

async function testVectorStore() {
  console.log('--- Testing Vector Store & Gemini Embeddings ---');

  const sampleEmail = `
    Hi Team, 
    Please be advised that our primary support operating hours are Monday to Friday, 9:00 AM to 5:00 PM EST. 
    For urgent tier-3 server outages outside these hours, please contact emergency-tech@krayn.io or call +1-800-555-0199.
  `;

  // 1. Chunk text
  const chunks = chunkText(sampleEmail, 'gmail', 'Support Hours Email');
  console.log(`Generated ${chunks.length} chunks.`);

  // 2. Insert into vector DB
  for (const chunk of chunks) {
    const id = await vectorStore.addChunk(chunk);
    console.log(`Indexed chunk ID: ${id}`);
  }

  // 3. Perform similarity query
  const query = 'What are the support operating hours?';
  console.log(`\nQuerying: "${query}"`);
  const results = await vectorStore.query(query, 2);

  console.log('\nTop Results:');
  results.forEach((res, i) => {
    console.log(`\n[Result ${i + 1}] Score: ${(res.score * 100).toFixed(1)}%`);
    console.log(`Title: ${res.item.title} (${res.item.source})`);
    console.log(`Snippet: ${res.item.text}`);
  });

  const totalCount = await vectorStore.getCount();
  console.log(`\nTotal items stored in index: ${totalCount}`);
}

testVectorStore().catch(console.error);
