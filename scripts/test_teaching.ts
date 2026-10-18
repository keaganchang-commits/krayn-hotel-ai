import { teachUserFact } from '../src/lib/teaching/store';
import { vectorStore } from '../src/lib/vector/store';

async function testTeaching() {
  console.log('--- Testing Direct User Teaching Engine ---');

  const fact = {
    topic: 'Refund Policy',
    rule: 'Our standard customer refund policy is strictly 30 days from date of purchase for full money back.',
  };

  const result = await teachUserFact(fact);
  console.log(`Indexed ${result.syncedCount} rule chunks for: "${result.rule}"`);

  // Verify retrieval priority
  const queryRes = await vectorStore.query('What is the refund policy?', 1);
  console.log('\nTop Retrieved Context:');
  console.log(`Score: ${(queryRes[0].score * 100).toFixed(1)}%`);
  console.log(`Source: ${queryRes[0].item.source}`);
  console.log(`Snippet: ${queryRes[0].item.text}`);
}

testTeaching().catch(console.error);
