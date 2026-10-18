import { syncGmailEmails } from '../src/lib/gmail/sync.js';
import { vectorStore } from '../src/lib/vector/store.js';

async function testGmailSync() {
  console.log('--- Testing Live Gmail Sync & Vector Indexing ---');
  const result = await syncGmailEmails(3);

  console.log(`Synced ${result.syncedCount} chunks from ${result.emails.length} emails:`);
  result.emails.forEach((e, i) => {
    console.log(`\n[Email ${i + 1}] From: ${e.sender}`);
    console.log(`Subject: ${e.subject}`);
    console.log(`Snippet: ${e.snippet.slice(0, 80)}...`);
  });

  const totalCount = await vectorStore.getCount();
  console.log(`\nTotal items now in Vector DB: ${totalCount}`);
}

testGmailSync().catch(console.error);
