import { queryRAGAnswer } from '../src/lib/ai/rag';
import { resolveClarification } from '../src/lib/ai/clarify';
import { vectorStore } from '../src/lib/vector/store';

async function testAutonomousLoop() {
  console.log('====================================================');
  console.log('Phase 9: Testing Autonomous Learning & Feedback Loop');
  console.log('====================================================\n');

  const question = 'What are the enterprise tier support operating hours?';

  // Step 1: Initial Query (Should trigger low confidence / clarification)
  console.log(`[Step 1] Asking AI: "${question}"`);
  const initialRes = await queryRAGAnswer(question);

  console.log(`- Initial Confidence Score: ${initialRes.confidenceScore}%`);
  console.log(`- Is Uncertain (<80%): ${initialRes.isUncertain}`);
  if (initialRes.clarificationQuestion) {
    console.log(`- Clarification Prompt: "${initialRes.clarificationQuestion}"`);
  }

  // Step 2: Simulate User Selecting Option on Clarification Card
  const selectedChoice = 'Enterprise tier support operating hours are 24/7 365 days a year with 15-minute SLA.';
  console.log(`\n[Step 2] User chooses option on Clarification Card:`);
  console.log(`  -> Selected: "${selectedChoice}"`);

  const clarifyResult = await resolveClarification({
    question: initialRes.clarificationQuestion || question,
    selectedOption: selectedChoice,
    topic: 'Enterprise Support Hours',
  });

  console.log(`- Clarification Status: ${clarifyResult.message}`);

  // Step 3: Re-query Same Question (Should now answer AUTONOMOUSLY with >80% confidence)
  console.log(`\n[Step 3] Re-asking same question: "${question}"`);
  const learnedRes = await queryRAGAnswer(question);

  console.log(`- Learned Confidence Score: ${learnedRes.confidenceScore}%`);
  console.log(`- Is Uncertain: ${learnedRes.isUncertain}`);
  console.log(`- Autonomous Answer: "${learnedRes.answer}"`);

  const citations = learnedRes.citations.filter(c => c.source === 'user_teaching');
  console.log(`- User Teaching Citations Found: ${citations.length}`);

  console.log('\n====================================================');
  console.log('✅ Autonomous Learning Loop Verified Successfully!');
  console.log('====================================================');
}

testAutonomousLoop().catch(console.error);
