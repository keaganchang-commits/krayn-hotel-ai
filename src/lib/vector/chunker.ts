export interface TextChunk {
  id: string;
  text: string;
  source: 'gmail' | 'pdf' | 'user_teaching' | 'clarification' | 'image';
  title: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

/**
 * Split large text into clean semantic chunks for vector storage
 */
export function chunkText(
  text: string,
  source: TextChunk['source'],
  title: string,
  chunkSize: number = 500,
  overlap: number = 50
): Omit<TextChunk, 'id'>[] {
  const cleanedText = text.replace(/\s+/g, ' ').trim();
  if (!cleanedText) return [];

  const chunks: Omit<TextChunk, 'id'>[] = [];
  let start = 0;

  while (start < cleanedText.length) {
    let end = start + chunkSize;
    
    // Adjust end boundary to sentence or space if possible
    if (end < cleanedText.length) {
      const lastPeriod = cleanedText.lastIndexOf('.', end);
      if (lastPeriod > start + chunkSize / 2) {
        end = lastPeriod + 1;
      } else {
        const lastSpace = cleanedText.lastIndexOf(' ', end);
        if (lastSpace > start) {
          end = lastSpace;
        }
      }
    } else {
      end = cleanedText.length;
    }

    const chunkContent = cleanedText.slice(start, end).trim();
    if (chunkContent.length > 0) {
      chunks.push({
        text: chunkContent,
        source,
        title,
        timestamp: new Date().toISOString(),
      });
    }

    start = end - overlap;
    if (start >= cleanedText.length || end === cleanedText.length) break;
  }

  return chunks;
}
