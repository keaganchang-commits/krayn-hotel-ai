import { vectorStore } from '@/lib/vector/store';
import { getGeminiClient } from '@/lib/ai/gemini';
import { normalizeQuestionText, getSemanticQuestionKey } from '@/lib/clarify/seedQuestions';

export interface AnswerCheckResult {
  hasAnswer: boolean;
  confidence: number;
  answeringSnippet?: string;
  answeringTitle?: string;
}

/**
 * Checks whether a given question already has a confident, verified answer
 * stored in the Knowledge Hub (across all sources: user_teaching, pdf, images, manual rules).
 */
export async function isQuestionAnsweredInKnowledgeHub(
  question: string,
  confirmedItemsCache?: Array<{ id: string; title: string; text: string; source: string; metadata?: any }>
): Promise<AnswerCheckResult> {
  if (!question || !question.trim()) {
    return { hasAnswer: false, confidence: 0 };
  }

  const normQ = normalizeQuestionText(question);
  const semanticKey = getSemanticQuestionKey(question);

  // 1. Fetch confirmed knowledge items if not supplied
  const confirmed = confirmedItemsCache
    ? confirmedItemsCache.filter(i => i.source !== 'clarification')
    : (await vectorStore.listItems()).filter(i => i.source !== 'clarification');

  if (confirmed.length === 0) {
    return { hasAnswer: false, confidence: 0 };
  }

  // Pre-fetch assets once (NOT inside the loop!)
  const { listBusinessAssets } = await import('@/lib/assets/storage');
  const existingAssets = listBusinessAssets();
  const assetNames = existingAssets.map(a => `${a.name} ${a.description || ''} ${(a.relevantTopics || []).join(' ')}`.toLowerCase());

  const isDocOrMenuRequest = 
    normQ.includes('menu') ||
    normQ.includes('brochure') ||
    normQ.includes('catalog') ||
    normQ.includes('catalogue') ||
    normQ.includes('wine list') ||
    normQ.includes('drinks list') ||
    normQ.includes('beverage list') ||
    normQ.includes('price list') ||
    normQ.includes('rate card') ||
    normQ.includes('master wine list') ||
    normQ.includes('provide the full') ||
    normQ.includes('provide the complete') ||
    normQ.includes('attach');

  if (isDocOrMenuRequest) {
    const mentionsMerdeka = normQ.includes('merdeka') || normQ.includes('grill') || normQ.includes('dinner');
    const mentionsLounge = normQ.includes('lounge') || normQ.includes('tea') || normQ.includes('all-day') || normQ.includes('all day');
    const mentionsCacao = normQ.includes('cacao') || normQ.includes('chocolate');
    const mentionsWineOrBev = normQ.includes('wine') || normQ.includes('beverage') || normQ.includes('drinks') || normQ.includes('cocktail');

    for (const assetStr of assetNames) {
      if (mentionsMerdeka && (assetStr.includes('merdeka') || assetStr.includes('grill'))) {
        return { hasAnswer: true, confidence: 100, answeringTitle: 'Uploaded Business Asset' };
      }
      if (mentionsLounge && (assetStr.includes('lounge') || assetStr.includes('all-day') || assetStr.includes('tea'))) {
        return { hasAnswer: true, confidence: 100, answeringTitle: 'Uploaded Business Asset' };
      }
      if (mentionsWineOrBev && (assetStr.includes('menu') || assetStr.includes('lounge') || assetStr.includes('grill'))) {
        return { hasAnswer: true, confidence: 95, answeringTitle: 'Uploaded Business Asset' };
      }
    }

    if (!mentionsMerdeka && !mentionsLounge && !mentionsCacao && existingAssets.length > 0) {
      const hasAnyMenuAsset = existingAssets.some(a => a.name.toLowerCase().includes('menu') || (a.relevantTopics || []).includes('menu'));
      if (hasAnyMenuAsset) {
        return { hasAnswer: true, confidence: 95, answeringTitle: 'Uploaded Business Asset' };
      }
    }
  }

  // 2. High-speed Direct Heuristic / Lexical & Semantic Verification:
  for (const item of confirmed) {
    const itemText = (item.text || '').toLowerCase();
    const itemTitle = (item.title || '').toLowerCase();
    const combined = `${itemTitle} ${itemText}`;

    // A. Explicit Question match recorded in user teaching/rule metadata
    if (item.metadata?.question) {
      const recordedNorm = normalizeQuestionText(String(item.metadata.question));
      if (recordedNorm === normQ || (normQ && recordedNorm.includes(normQ))) {
        return { hasAnswer: true, confidence: 100, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    if (item.metadata?.resolvedQuestion) {
      const resolvedNorm = normalizeQuestionText(String(item.metadata.resolvedQuestion));
      if (resolvedNorm === normQ || (normQ && resolvedNorm.includes(normQ))) {
        return { hasAnswer: true, confidence: 100, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // B. "Regarding <question>, confirmed answer is: <ans>" match
    const regardingMatch = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
    if (regardingMatch && regardingMatch[1]) {
      const regardingNorm = normalizeQuestionText(regardingMatch[1]);
      if (regardingNorm === normQ || (normQ && regardingNorm.includes(normQ))) {
        return { hasAnswer: true, confidence: 100, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // D. Explicit Domain-Fact Keywords Check
    // e.g. Reservation policy / Securing a table / Walk-ins
    if (
      normQ.includes('reservation') ||
      normQ.includes('reservations') ||
      normQ.includes('book a table') ||
      normQ.includes('walk in') ||
      normQ.includes('walk-in') ||
      normQ.includes('securing a table')
    ) {
      if (
        (combined.includes('reservation') || combined.includes('booking')) &&
        (combined.includes('required') || combined.includes('recommended') || combined.includes('advance') || combined.includes('table') || combined.includes('policy'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Dining outlet hours (Cacao, Merdeka Grill, Park Lounge) & General Dinner / Lunch hours
    if (
      normQ.includes('hours') ||
      normQ.includes('operating') ||
      normQ.includes('open') ||
      normQ.includes('closing') ||
      normQ.includes('schedule') ||
      normQ.includes('timing')
    ) {
      if (
        (normQ.includes('dinner') || normQ.includes('evening')) &&
        (combined.includes('dinner hours') || combined.includes('18:00') || combined.includes('6:00 pm') || combined.includes('22:30') || combined.includes('10:30 pm'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
      if (
        (normQ.includes('lunch') || normQ.includes('afternoon')) &&
        (combined.includes('lunch hours') || combined.includes('12:00') || combined.includes('15:00') || combined.includes('3:00 pm'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
      if (normQ.includes('cacao') && combined.includes('cacao') && (combined.includes('hours') || combined.includes('17:00') || combined.includes('5:00 pm') || combined.includes('daily'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
      if ((normQ.includes('merdeka') || normQ.includes('grill')) && combined.includes('merdeka') && (combined.includes('hours') || combined.includes('lunch') || combined.includes('dinner'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
      if (normQ.includes('park lounge') && combined.includes('park lounge') && (combined.includes('hours') || combined.includes('tea') || combined.includes('breakfast') || combined.includes('all-day'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Cuisine theme / Culinary focus / Products served
    if (
      normQ.includes('cuisine') ||
      normQ.includes('culinary') ||
      normQ.includes('theme') ||
      normQ.includes('specialize in') ||
      normQ.includes('specialty') ||
      normQ.includes('type of food') ||
      normQ.includes('products are served') ||
      normQ.includes('food or products')
    ) {
      if (
        (normQ.includes('merdeka') || normQ.includes('grill')) &&
        (combined.includes('merdeka') || combined.includes('grill')) &&
        (combined.includes('cuts') || combined.includes('seafood') || combined.includes('produce') || combined.includes('cuisine') || combined.includes('menu'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
      if (
        normQ.includes('cacao') &&
        combined.includes('cacao') &&
        (combined.includes('chocolate') || combined.includes('mixology') || combined.includes('cocktail'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Pool availability
    if (normQ.includes('pool')) {
      if (combined.includes('pool') && (combined.includes('indoor') || combined.includes('outdoor') || combined.includes('swimming') || combined.includes('level 99') || combined.includes('available'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Specific menu item prices (e.g. burgers, toast, cod, juices, biryani, ice cream, pasta)
    if (
      normQ.includes('price') ||
      normQ.includes('cost') ||
      normQ.includes('how much') ||
      normQ.includes('pricing')
    ) {
      // Extract candidate item names from the question
      const words = normQ.replace(/[^a-z0-9 ]/g, '').split(' ').filter(w => w.length > 3 && !['what', 'prices', 'price', 'pricing', 'cost', 'these', 'items', 'with', 'from', 'does'].includes(w));
      let matches = 0;
      for (const w of words) {
        if (combined.includes(w)) matches++;
      }
      if (matches >= 2 && (combined.includes('myr') || combined.includes('rm') || combined.includes('$'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Tax & Service Charge policies
    if (normQ.includes('tax') || normQ.includes('service charge') || normQ.includes('prevailing taxes')) {
      if (combined.includes('tax') && (combined.includes('inclusive') || combined.includes('prevailing') || combined.includes('net') || combined.includes('plus'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Non-alcoholic, mocktails, juices
    if (normQ.includes('mocktail') || normQ.includes('non-alcoholic') || normQ.includes('zero proof') || normQ.includes('cold press juice')) {
      if (
        (combined.includes('zero proof') || combined.includes('mocktail') || combined.includes('non-alcoholic') || combined.includes('cold press')) &&
        (combined.includes('myr') || combined.includes('served') || combined.includes('cocktail'))
      ) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Corkage fee
    if (normQ.includes('corkage') || normQ.includes('bring their own wine') || normQ.includes('bring your own')) {
      if (combined.includes('corkage') && (combined.includes('fee') || combined.includes('myr') || combined.includes('prohibited') || combined.includes('allowed'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Printing services
    if (normQ.includes('printing') || normQ.includes('business center') || normQ.includes('print document')) {
      if (combined.includes('printing') && (combined.includes('front desk') || combined.includes('business centre') || combined.includes('business center'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Level 99 Wellness / Facilities
    if (normQ.includes('wellness') && (normQ.includes('level 99') || normQ.includes('l99') || normQ.includes('facilities'))) {
      if ((combined.includes('wellness') || combined.includes('spa') || combined.includes('fitness')) && (combined.includes('level 99') || combined.includes('l99'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Technogym 24/7 access
    if (normQ.includes('technogym') || (normQ.includes('fitness') && normQ.includes('247'))) {
      if (combined.includes('fitness') && (combined.includes('24 hours') || combined.includes('24/7') || combined.includes('technogym'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Pool hours
    if ((normQ.includes('hours') || normQ.includes('schedule') || normQ.includes('timing') || normQ.includes('open')) && normQ.includes('pool')) {
      if (combined.includes('pool') && (combined.includes('hours:') || combined.includes('07:00') || combined.includes('open'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Pet policy
    if (normQ.includes('pet policy') || normQ.includes('pets allowed')) {
      if (combined.includes('pet') && (combined.includes('policy') || combined.includes('allowed') || combined.includes('not allowed') || combined.includes('strictly prohibited'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Cancellation policy
    if (normQ.includes('cancellation') || normQ.includes('refund')) {
      if (combined.includes('cancellation') && (combined.includes('hours') || combined.includes('policy') || combined.includes('non-refundable') || combined.includes('free'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Breakfast included
    if (normQ.includes('breakfast') && (normQ.includes('included') || normQ.includes('complimentary') || normQ.includes('buffet'))) {
      if (combined.includes('breakfast') && (combined.includes('included') || combined.includes('complimentary') || combined.includes('rate') || combined.includes('available at') || combined.includes('charge'))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Shuttle service
    if (normQ.includes('airport shuttle') || normQ.includes('shuttle service')) {
      if (combined.includes('shuttle') || (combined.includes('airport') && (combined.includes('transfer') || combined.includes('limousine')))) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Wi-Fi policy / connectivity
    if (normQ.includes('wifi') || normQ.includes('wi fi') || normQ.includes('internet')) {
      if (combined.includes('wi-fi') || combined.includes('wifi') || combined.includes('internet')) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Bathroom features & amenities
    if (normQ.includes('bathroom') || (normQ.includes('bath') && normQ.includes('amenit'))) {
      if (combined.includes('bathroom') || combined.includes('bathtub') || combined.includes('shower')) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Baby crib / cot policy
    if (normQ.includes('crib') || normQ.includes('baby cot') || normQ.includes('infant bed')) {
      if (combined.includes('crib') || combined.includes('cot') || combined.includes('rollaway')) {
        return { hasAnswer: true, confidence: 95, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. Room configuration / categories
    if ((normQ.includes('room') || normQ.includes('suite')) && (normQ.includes('config') || normQ.includes('standard') || normQ.includes('categor'))) {
      if (combined.includes('standard room configuration') || combined.includes('guestrooms') || combined.includes('suites') || combined.includes('1 king bed')) {
        return { hasAnswer: true, confidence: 90, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }

    // e.g. On-site facilities & amenities (gym, pool, spa)
    if (normQ.includes('amenities are available') || normQ.includes('wellness and facility amenities') || normQ.includes('facilities are available')) {
      if (combined.includes('fitness centre') || combined.includes('indoor pool') || combined.includes('spa') || combined.includes('wellness')) {
        return { hasAnswer: true, confidence: 90, answeringSnippet: item.text, answeringTitle: item.title };
      }
    }
  }

  // 3. Fast Lexical & Semantic Relevance Matching (Instant & zero API quota consumption)
  const questionWords = normQ.split(' ').filter(w => w.length > 3);
  let bestCandidate: { item: typeof confirmed[0]; matchCount: number } | null = null;

  for (const item of confirmed) {
    const combined = `${item.title} ${item.text}`.toLowerCase();
    let matchCount = 0;
    for (const word of questionWords) {
      if (combined.includes(word)) matchCount++;
    }
    if (matchCount >= 2 && (!bestCandidate || matchCount > bestCandidate.matchCount)) {
      bestCandidate = { item, matchCount };
    }
  }

  // If question words strongly match a confirmed fact (>= 60%), consider it answered instantly
  if (bestCandidate && questionWords.length > 0 && (bestCandidate.matchCount / questionWords.length) >= 0.6) {
    return {
      hasAnswer: true,
      confidence: 85,
      answeringSnippet: bestCandidate.item.text,
      answeringTitle: bestCandidate.item.title,
    };
  }

  return { hasAnswer: false, confidence: 0 };
}
