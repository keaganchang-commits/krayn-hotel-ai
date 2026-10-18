import { vectorStore } from '@/lib/vector/store';

export interface DeduplicateResult {
  removedCount: number;
  mergedCount: number;
  remainingCount: number;
}

/**
 * Normalizes text for similarity comparison:
 * Lowercases, strips punctuation, normalizes whitespace.
 */
export function normalizeKey(str: string): string {
  if (!str) return '';
  return str
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Checks if detail2 is redundant given detail1:
 * e.g. "ArtLink." vs "ArtLink", or "G.A Group" vs "G.A Group (London-based)", or "Fender Katsalidis" vs "Fender Katsalidis in association with RSP KL"
 */
export function areDetailsRedundantOrSubsumed(d1: string, d2: string): boolean {
  const n1 = normalizeKey(d1);
  const n2 = normalizeKey(d2);
  if (n1 === n2) return true;
  if (n1.length > 5 && n2.length > 5) {
    if (n1.startsWith(n2) || n2.startsWith(n1)) return true;
    if (n1.includes(n2) || n2.includes(n1)) return true;
  }
  return false;
}

/**
 * Chooses the richer, more informative detail string between two versions
 */
export function getRicherDetail(d1: string, d2: string): string {
  const clean1 = d1.trim().replace(/[.]+$/, '');
  const clean2 = d2.trim().replace(/[.]+$/, '');
  if (clean1.length >= clean2.length) return clean1;
  return clean2;
}

/**
 * Canonicalizes a topic string into a standard, clean identity key.
 * e.g. "Check-in", "Check-in time", "Estimated Check-in" -> "check in time"
 */
export function canonicalizeTopicKey(rawTopic: string): string {
  let clean = rawTopic
    .toLowerCase()
    .replace(/^estimated\s+/i, '')
    .replace(/^official\s+/i, '')
    .replace(/^standard\s+/i, '')
    .replace(/^general\s+/i, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  // Normalize common variations
  if (/^check\s*in(\s*(time|policy|hours|schedule|rules?))?$/i.test(clean)) return 'check in time';
  if (/^check\s*out(\s*(time|policy|hours|schedule|rules?))?$/i.test(clean)) return 'check out policy';
  if (/^(late\s*check\s*out|checkout\s*extension)(\s*(time|policy|hours|rules?|fee))?$/i.test(clean)) return 'late check out policy';
  if (/^(early\s*check\s*in)(\s*(time|policy|hours|rules?|fee))?$/i.test(clean)) return 'early check in policy';
  if (/^(guest\s*stay|stay\s*duration|guest\s*duration)(\s*(time|policy|limit|rules?))?$/i.test(clean)) return 'guest stay duration';
  if (/^(guest\s*amenit(y|ies)|complimentary\s*amenit(y|ies))(\s*(time|policy|limit|rules?))?$/i.test(clean)) return 'guest amenities policy';
  if (/^sauna(\s*(opening|operating|service)?)?(\s*(hours|schedule|policy|rules?))?$/i.test(clean)) return 'sauna opening hours';
  if (/^gym(\s*(opening|operating|service)?)?(\s*(hours|schedule|policy|rules?))?$/i.test(clean) || /^fitness(\s*centre)?(\s*(hours|schedule))?$/i.test(clean)) return 'gym hours';
  if (/^pool(\s*(opening|operating|service)?)?(\s*(hours|schedule|policy|rules?))?$/i.test(clean) || /^swimming\s*pool(\s*(hours|schedule))?$/i.test(clean)) return 'swimming pool hours';
  if (/^breakfast(\s*(service|operating)?)?(\s*(hours|schedule|timing|policy|rules?))?$/i.test(clean)) return 'breakfast hours';
  if (/^lunch(\s*(operational|operating|service)?)?(\s*(hours|schedule|timing|policy|rules?))?$/i.test(clean)) return 'lunch operational hours';
  if (/^dinner(\s*(operational|operating|service)?)?(\s*(hours|schedule|timing|policy|rules?))?$/i.test(clean)) return 'dinner operational hours';
  if (/^(valet\s*parking(\s*fee)?|parking\s*valet)$/i.test(clean)) return 'valet parking fee';
  if (/^luggage(\s*storage)?(\s*(policy|rules?|fee|complimentary))?$/i.test(clean)) return 'luggage storage policy';
  if (/^(hotel\s*)?opening\s*date$/i.test(clean)) return 'hotel opening date';
  if (/dietary.*(policy|management|requirement|allergy)/i.test(clean)) return 'hotel dietary policy';
  if (/executive\s*chef/i.test(clean)) return 'executive chef';
  if (/executive\s*pastry\s*chef/i.test(clean)) return 'executive pastry chef';
  if (/pricing\s*currency/i.test(clean) || /menu\s*currency/i.test(clean)) return 'pricing currency';
  if (/tax\s*policy/i.test(clean)) return 'menu tax policy';

  return clean;
}

/**
 * Splits compound topics (e.g. Check-in/Check-out, Luggage & Late Checkout) into individual atomic items.
 */
function splitCompoundFact(item: any): Array<{ topic: string; detail: string; title: string }> | null {
  const topic = String(item.metadata?.topic || item.title || '').trim();
  const detail = String(item.metadata?.detail || item.text || '').trim();

  // 0. Compound Luggage Storage & Late Checkout
  if (/luggage.*(?:and|&).*(?:late checkout|checkout)/i.test(topic) || /late checkout.*(?:and|&).*luggage/i.test(topic)) {
    const parts = detail.split(/(?=[Ll]ate checkout|[Gg]uests are permitted to store)/);
    const luggagePart = parts.find(p => /luggage/i.test(p));
    const latePart = parts.find(p => /late checkout/i.test(p));
    if (luggagePart && latePart) {
      return [
        { topic: 'Luggage Storage Policy', detail: luggagePart.trim().replace(/^,\s*and\s*/i, '').replace(/^[.,\s]+/, ''), title: 'Luggage Storage Policy' },
        { topic: 'Late Checkout Policy', detail: latePart.trim().replace(/^,\s*and\s*/i, '').replace(/^[.,\s]+/, ''), title: 'Late Checkout Policy' },
      ];
    }
  }

  // 1. Compound Check-in / Check-out
  if (/check[- ]?in\s*[\/&,]\s*check[- ]?out/i.test(topic)) {
    const inMatch = detail.match(/(?:check[- ]?in[:\s]*|^)([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|[0-9]{2}:[0-9]{2})/i);
    const outMatch = detail.match(/(?:check[- ]?out[:\s]*|and\s*)([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?|[0-9]{2}:[0-9]{2}\s*(?:check[- ]?out)?)/i);

    let inDetail = '';
    let outDetail = '';

    const checkInExtract = detail.match(/([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|[0-9]{2}))\s*check[- ]?in/i) || detail.match(/check[- ]?in[:\s]*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);
    const checkOutExtract = detail.match(/([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm|[0-9]{2}))\s*check[- ]?out/i) || detail.match(/check[- ]?out[:\s]*([0-9]{1,2}(?::[0-9]{2})?\s*(?:am|pm)?)/i);

    if (checkInExtract) inDetail = checkInExtract[1].trim();
    if (checkOutExtract) outDetail = checkOutExtract[1].trim();

    if (inDetail && outDetail) {
      return [
        { topic: 'Check-in time', detail: inDetail, title: 'Check-in time' },
        { topic: 'Check-out time', detail: outDetail, title: 'Check-out time' },
      ];
    }
  }

  return null;
}

/**
 * Performs a comprehensive deduplication and consolidation sweep across the Knowledge Hub.
 * Can be run on demand, after uploads, or during retrieval.
 */
export async function deduplicateKnowledgeHub(): Promise<DeduplicateResult> {
  const allItems = await vectorStore.listItems();
  const confirmed = allItems.filter(i => i.source !== 'clarification' && !i.metadata?.isAuditLog && !i.title?.startsWith('Audit:'));

  let removedCount = 0;
  let mergedCount = 0;

  // STEP 1: Split any compound items into separate clean atomic rows
  for (const item of confirmed) {
    const splitResult = splitCompoundFact(item);
    if (splitResult && splitResult.length > 0) {
      await vectorStore.deleteItem(item.id);
      removedCount++;

      for (const splitPart of splitResult) {
        await vectorStore.addChunk({
          text: `${splitPart.topic}: ${splitPart.detail}`,
          source: item.source || 'pdf',
          title: splitPart.title,
          timestamp: item.timestamp || new Date().toISOString(),
          metadata: {
            ...(item.metadata || {}),
            topic: splitPart.topic,
            detail: splitPart.detail,
          },
        });
        mergedCount++;
      }
    }
  }

  // STEP 2: Re-fetch updated items after splits and group by canonical topic
  const refreshedItems = await vectorStore.listItems();
  const refreshedConfirmed = refreshedItems.filter(
    i => i.source !== 'clarification' && !i.metadata?.isAuditLog && !i.title?.startsWith('Audit:')
  );

  const topicGroups = new Map<string, typeof refreshedConfirmed>();

  for (const item of refreshedConfirmed) {
    const rawTopic = String(item.metadata?.topic || item.title || '').trim();
    const venue = String(
      item.metadata?.venue || item.metadata?.documentName || item.metadata?.fileName || ''
    ).trim().toLowerCase();

    const canonTopic = canonicalizeTopicKey(rawTopic);
    // General hotel-wide policies deduplicate globally regardless of document name:
    const isGlobalPolicy = /^(check in time|check out policy|late check out policy|early check in policy|guest stay duration|guest amenities policy|breakfast hours|lunch operational hours|dinner operational hours|sauna opening hours|gym hours|swimming pool hours|business type|brand voice|booking method|target clients|primary services|valet parking fee|hotel opening date|hotel dietary policy|executive chef|executive pastry chef|pricing currency|menu tax policy)$/i.test(canonTopic);
    const groupKey = (venue && !isGlobalPolicy) ? `${venue}:::${canonTopic}` : canonTopic;

    if (!topicGroups.has(groupKey)) {
      topicGroups.set(groupKey, []);
    }
    topicGroups.get(groupKey)!.push(item);
  }

  // STEP 3: Deduplicate each canonical topic group
  const allIdsToDelete: string[] = [];

  for (const [_, group] of topicGroups.entries()) {
    if (group.length <= 1) continue;

    const toDelete = new Set<string>();

    // Sort: user_teaching has highest authority, then latest timestamp
    group.sort((a, b) => {
      const aIsUser = a.source === 'user_teaching' || a.metadata?.isGroundTruth ? 1 : 0;
      const bIsUser = b.source === 'user_teaching' || b.metadata?.isGroundTruth ? 1 : 0;
      if (aIsUser !== bIsUser) return bIsUser - aIsUser;

      const timeA = new Date(a.metadata?.taughtAt || a.timestamp || 0).getTime();
      const timeB = new Date(b.metadata?.taughtAt || b.timestamp || 0).getTime();
      return timeB - timeA;
    });

    const primaryItem = group[0];
    let primaryDetail = String(primaryItem.metadata?.detail || primaryItem.text.replace(/^[^:]+:\s*/, '')).trim();

    for (let j = 1; j < group.length; j++) {
      const secondaryItem = group[j];
      if (toDelete.has(secondaryItem.id)) continue;

      const secondaryDetail = String(secondaryItem.metadata?.detail || secondaryItem.text.replace(/^[^:]+:\s*/, '')).trim();

      // Check if one detail is an updated / richer version of the other
      if (secondaryDetail) {
        if (areDetailsRedundantOrSubsumed(primaryDetail, secondaryDetail)) {
          // If secondary is strictly richer (more complete details), keep the richer wording
          primaryDetail = getRicherDetail(primaryDetail, secondaryDetail);
        } else {
          // If they are distinct complementary facts under the same topic that flow together, merge them cleanly into one cohesive sentence
          const normP = primaryDetail.toLowerCase();
          const normS = secondaryDetail.toLowerCase();
          if (!normP.includes(normS) && !normS.includes(normP)) {
            // If primary is newer and explicitly conflicts with secondary (e.g. "Checkout time is 12:30 PM" vs "Checkout is 12 pm"),
            // the newer user statement (primaryItem) supersedes the older one!
            const isTimeOrValueConflict = /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(primaryDetail) && /\b\d{1,2}(:\d{2})?\s*(am|pm)\b/i.test(secondaryDetail);
            if (!isTimeOrValueConflict) {
              // Complementary related statements flow together!
              primaryDetail = `${primaryDetail.replace(/[.]+$/, '')}. ${secondaryDetail.replace(/^[a-z]/, c => c.toUpperCase())}`;
            }
          }
        }
      }

      toDelete.add(secondaryItem.id);
      allIdsToDelete.push(secondaryItem.id);
      removedCount++;
      mergedCount++;
    }

    // Update primary item in vector store if detail was enriched
    if (primaryDetail !== String(primaryItem.metadata?.detail || '').trim()) {
      const updatedChunkText = `${primaryItem.title || primaryItem.metadata?.topic}: ${primaryDetail}`;
      await vectorStore.updateItem(primaryItem.id, updatedChunkText, primaryItem.title, primaryDetail);
    }
  }

  if (allIdsToDelete.length > 0) {
    await vectorStore.deleteItemsBatch(allIdsToDelete);
  }

  const remaining = await vectorStore.listItems();
  const remainingConfirmed = remaining.filter(i => i.source !== 'clarification');

  return {
    removedCount,
    mergedCount,
    remainingCount: remainingConfirmed.length,
  };
}
