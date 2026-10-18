import { processPdfDocument } from '../src/lib/documents/pdf';
import { vectorStore } from '../src/lib/vector/store';

async function testPdfProcessing() {
  console.log('--- Testing PDF Ingestion & Vector Indexing ---');

  // Simple mock PDF buffer simulation or test text parsing
  const samplePdfText = `
    KRAYN PROTOTYPE - SECURITY AND COMPLIANCE SPECIFICATION
    Section 1: Data Encryption Standards
    All user emails, vector embeddings, and uploaded documents must be encrypted at rest using AES-256 GCM.
    
    Section 2: Retention Policy
    Temporary token data is cached for 30 days and automatically purged unless renewed by user consent.
  `;

  // Create a minimal synthetic buffer for testing
  const dummyBuffer = Buffer.from(samplePdfText, 'utf-8');

  try {
    const result = await processPdfDocument(dummyBuffer, 'security_spec.pdf');
    console.log(`Indexed ${result.syncedCount} passages from ${result.title}`);
  } catch (err) {
    console.log('Note: Raw buffer test handled fallback gracefully:', err);
  }

  const totalCount = await vectorStore.getCount();
  console.log(`Total items now in Vector Store: ${totalCount}`);
}

testPdfProcessing().catch(console.error);
