import { processAutoReplies } from '../src/lib/gmail/autoreply.js';

async function testAutoReplyDiagnostic() {
  console.log('--- Running Auto-Reply Diagnostic ---');
  const result = await processAutoReplies(5);
  console.log('Diagnostic Result:', JSON.stringify(result, null, 2));
}

testAutoReplyDiagnostic().catch(console.error);
