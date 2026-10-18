export type ClarificationInputType = 'options' | 'text' | 'file' | 'boolean';

export interface FollowUpSpec {
  question: string;
  options: string[];
  topic?: string;
  inputType?: ClarificationInputType;
  allowMultiple?: boolean;
  placeholder?: string;
}

export interface SeedQuestion {
  id: string;
  question: string;
  options: string[];
  title: string;
  priorityScore: number;
  inputType?: ClarificationInputType;
  placeholder?: string;
  allowMultiple?: boolean;
  followUpsByOption?: Record<string, FollowUpSpec[]>;
}

export const SEED_ONBOARDING_QUESTIONS: SeedQuestion[] = [
  {
    id: 'onboard-primary-offering',
    question: 'What does your business primarily provide?',
    options: ['Products', 'Services & Client Work', 'Both Products & Services'],
    title: 'Business Overview',
    priorityScore: 100,
    inputType: 'options',
    allowMultiple: false,
  },
  {
    id: 'onboard-customer-type',
    question: 'Who are your main customers?',
    options: ['Consumers (B2C)', 'Businesses (B2B)', 'Both B2B and B2C'],
    title: 'Business Overview',
    priorityScore: 95,
    inputType: 'options',
    allowMultiple: false,
  },
  {
    id: 'onboard-delivery-model',
    question: 'How do customers purchase from you?',
    options: ['Online / Self-serve', 'Bookings & quotes', 'In-person / On-site'],
    title: 'Business Overview',
    priorityScore: 90,
    inputType: 'options',
    allowMultiple: true,
  },
  {
    id: 'onboard-brand-voice',
    question: 'What email tone should the AI use?',
    options: ['Warm & friendly', 'Professional & executive', 'Direct & concise'],
    title: 'Communication',
    priorityScore: 85,
    inputType: 'options',
    allowMultiple: false,
  },
];

/**
 * Robustly normalizes question text to compare semantic duplicates
 * ignoring punctuation, case, whitespace, and leading prompt prefixes.
 */
export function normalizeQuestionText(text: string): string {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/^proactive clarification needed for [^:]+:\s*/i, '')
    .replace(/^customer asked:\s*["']?/i, '')
    .replace(/["']?\s*\.?\s*how should (krayn ai|the ai|we) respond\??$/i, '')
    .replace(/^regarding ["']?/i, '')
    .replace(/["']?,\s*the confirmed answer is:[\s\S]*$/i, '')
    .replace(/^(hi|hello|hey|good day|dear|to whom it may concern)[,\s]+/i, '')
    .replace(/^may i know if\s+/i, '')
    .replace(/^could you tell me if\s+/i, '')
    .replace(/^do you know if\s+/i, '')
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Automatically infers whether a question requires a PDF/image file upload,
 * open text input, binary yes/no toggle, or multiple choice options.
 */
export function inferClarificationInputType(question: string, existingType?: ClarificationInputType): {
  inputType: ClarificationInputType;
  placeholder?: string;
} {
  const q = (question || '').toLowerCase().trim();

  // 1. File Upload (documents, menus, catalogs, price sheets, brochures, floor plans, images, photos)
  // Whenever a question involves menus, brochures, price sheets, floor plans, or catalogs, file upload is always the primary/default inputType across all businesses.
  const fileKeywords = [
    'menu', 'catalog', 'catalogue', 'brochure', 'price sheet', 'rate card',
    'floor plan', 'document', 'upload', 'attach', 'photo of', 'photos of',
    'pamphlet', 'contract template', 'intake form', 'wine list', 'drink list',
    'cocktail list', 'price list', 'spec sheet', 'room layout', 'flyer'
  ];
  // Exclude dietary queries (e.g., "specific dietary menus (Halal, Vegan)") from file upload — these are options selections
  const isDietaryQuery = q.includes('dietary') || q.includes('halal') || q.includes('vegan') || q.includes('vegetarian') || q.includes('gluten');

  if (fileKeywords.some(kw => q.includes(kw)) && !isDietaryQuery) {
    return { inputType: 'file' };
  }

  if (existingType && existingType !== 'options') {
    return { inputType: existingType };
  }

  // 2. Open Text Input (operating hours, opening times, phone numbers, addresses, contact emails, specific fees)
  if (
    q.includes('hours') ||
    q.includes('opening time') ||
    q.includes('operating time') ||
    q.includes('closing time') ||
    q.includes('schedule')
  ) {
    return {
      inputType: 'text',
      placeholder: 'e.g., Mon-Fri 8:00 AM - 10:00 PM, Sat-Sun 9:00 AM - 11:00 PM',
    };
  }

  if (q.includes('phone') || q.includes('hotline') || q.includes('contact number') || q.includes('telephone')) {
    return {
      inputType: 'text',
      placeholder: 'e.g., +60 3 2182 1234',
    };
  }

  if (q.includes('address') || q.includes('exact location') || q.includes('where is the hotel located')) {
    return {
      inputType: 'text',
      placeholder: 'e.g., Level 99, 118 Merdeka Tower, Kuala Lumpur',
    };
  }

  if (q.includes('email') || q.includes('inbox') || q.includes('contact email')) {
    return {
      inputType: 'text',
      placeholder: 'e.g., reservations@hotel.com',
    };
  }

  if (q.includes('date') || q.includes('when') || q.includes('time of') || q.includes('calendar')) {
    return {
      inputType: 'text',
      placeholder: 'e.g., Today at 7:00 PM, Tomorrow, or Oct 24',
    };
  }

  // 3. Binary Yes / No Toggle
  // Questions starting with "Is...", "Do you...", "Does the...", "Are...", "Can...", "Will..."
  // unless they explicitly have "or" presenting different categories
  const isBinaryQuestion = (
    q.startsWith('is ') ||
    q.startsWith('are ') ||
    q.startsWith('do you ') ||
    q.startsWith('does ') ||
    q.startsWith('can ') ||
    q.startsWith('will ') ||
    q.startsWith('have you ')
  ) && !q.includes(' or ') && !q.includes('which ') && !q.includes('what ') && !isDietaryQuery && !q.includes('(e.g.');

  if (isBinaryQuestion) {
    return { inputType: 'boolean' };
  }

  return { inputType: 'options' };
}

/**
 * Intelligently determines whether a question is inherently single-choice (one mutually exclusive policy)
 * or multi-choice (multiple offerings/amenities/payment methods can be true simultaneously).
 */
export function inferClarificationMultiSelect(question: string, existingAllowMultiple?: boolean): boolean {
  const q = (question || '').toLowerCase().trim();

  // Explicit MULTI-CHOICE question indicators:
  // E.g. "Which dining outlets are currently available on-site?"
  // E.g. "What primary bed configurations are available in standard rooms?"
  // E.g. "What payment methods are accepted?"
  const explicitMultiKeywords = [
    'dining outlet', 'dining outlets', 'restaurants', 'outlets',
    'bed configuration', 'bed configurations', 'bed options', 'beds available', 'what bed',
    'room type', 'room types',
    'amenities', 'facilities', 'payment methods', 'methods of payment',
    'which languages', 'languages spoken',
    'services offered', 'services available', 'what services',
    'dietary options', 'dietary menus', 'dietary', 'halal', 'vegan', 'vegetarian', 'gluten-free', 'allergies',
    'parking options', 'parking do you offer',
    'features', 'channels', 'accepted payment', 'accepted methods',
    'which of the following', 'select all', 'options are available'
  ];

  if (explicitMultiKeywords.some(kw => q.includes(kw))) {
    return true;
  }

  // Plural query indicators for offerings: "which ... are", "what ... are", "what ... do you offer/provide"
  if (
    (/\b(which|what)\s+([a-z\s]+)\s+are\b/i.test(q) && !q.includes('what are the hours') && !q.includes('what are the operating hours')) ||
    /\bwhat\s+([a-z\s]+)\s+(do you provide|do you offer|are available)\b/i.test(q)
  ) {
    // If asking about a singular policy or time, keep single
    if (!q.includes('check-in') && !q.includes('check-out') && !q.includes('cancellation') && !q.includes('policy')) {
      return true;
    }
  }

  // If already explicitly configured in metadata, respect it unless overridden by above clear plural rules
  if (existingAllowMultiple !== undefined) {
    return existingAllowMultiple;
  }

  // Inherently SINGLE-CHOICE: Mutually exclusive policies, rules, tone, single time windows
  const singleChoicePatterns = [
    'pet policy', 'pets allowed', 'cancellation window', 'cancellation policy',
    'check-in time', 'check-out time', 'tone', 'voice', 'main client',
    'single', 'minimum age', 'deposit policy', 'smoking policy', 'dress code',
    'currency', 'standard procedure', 'fee structure'
  ];

  if (singleChoicePatterns.some(pattern => q.includes(pattern))) {
    return false;
  }

  // Default: if asking "What is your [singular policy]?" -> single choice.
  if (q.startsWith('what is your ') || q.startsWith('what is the policy') || q.startsWith('is there a standard')) {
    return false;
  }

  return false;
}

/**
 * Computes a semantic topic key for a question to catch paraphrased duplicates
 * (e.g. "What parking do you offer?" vs "Does the hotel provide valet, self-parking, or off-site options?")
 */
export function getSemanticQuestionKey(question: string): string {
  const norm = normalizeQuestionText(question);
  
  // Outlet-specific dining menus & operational details (MUST be checked before generic dining!)
  if (norm.includes('cacao')) {
    if (norm.includes('hour') || norm.includes('time') || norm.includes('open') || norm.includes('close')) return 'topic:hours_cacao';
    return 'topic:menu_cacao';
  }
  if (norm.includes('merdeka') || norm.includes('grill')) {
    if (norm.includes('hour') || norm.includes('time') || norm.includes('open') || norm.includes('close')) return 'topic:hours_merdeka_grill';
    return 'topic:menu_merdeka_grill';
  }
  if (norm.includes('lounge') || norm.includes('park lounge')) {
    if (norm.includes('hour') || norm.includes('time') || norm.includes('open') || norm.includes('close')) return 'topic:hours_park_lounge';
    return 'topic:menu_park_lounge';
  }

  // High-frequency operational dimensions
  if (norm.includes('dietary') || norm.includes('halal') || norm.includes('gluten') || norm.includes('vegan') || norm.includes('vegetarian')) return 'topic:dietary';
  if (norm.includes('parking') || norm.includes('valet')) return 'topic:parking';
  if (norm.includes('breakfast')) return 'topic:breakfast';
  if (norm.includes('dining') || norm.includes('restaurant') || norm.includes('cafe')) return 'topic:dining';
  if (norm.includes('shuttle') || norm.includes('airport')) return 'topic:airport_shuttle';
  if (norm.includes('pet ') || norm.includes('pets ') || norm.includes('dog ') || norm.includes('animal')) return 'topic:pets';
  if (norm.includes('pool') && norm.includes('child')) return 'topic:pool_children';
  if (norm.includes('pool')) return 'topic:pool';
  if (norm.includes('gym') || norm.includes('fitness') || norm.includes('workout')) return 'topic:fitness';
  if (norm.includes('crib') || norm.includes('baby cot') || norm.includes('infant bed')) return 'topic:cribs';
  if (norm.includes('bed') || norm.includes('rollaway')) return 'topic:bed_types';
  if (norm.includes('cancellation') || norm.includes('refund')) return 'topic:cancellation';
  if (norm.includes('checkin') || norm.includes('check in') || norm.includes('checkout') || norm.includes('check out')) return 'topic:checkin';
  if (norm.includes('payment') || norm.includes('credit card') || norm.includes('cashless')) return 'topic:payments';
  if (norm.includes('print') || norm.includes('business center')) return 'topic:printing';
  if (norm.includes('hours') && norm.includes('pool')) return 'topic:hours_pool';
  if (norm.includes('hours') && norm.includes('gym')) return 'topic:hours_gym';
  if (norm.includes('spa') || norm.includes('massage')) {
    if (norm.includes('hour') || norm.includes('time') || norm.includes('open') || norm.includes('close')) return 'topic:hours_spa';
    return 'topic:spa_services';
  }

  // Room & Suite categories (unifies all variants: "standard room or suite categories", "room categories", "suite categories", "range of room/suite categories", "which room or suite categories")
  if (
    (norm.includes('room') || norm.includes('suite')) &&
    (norm.includes('categor') || norm.includes('type') || norm.includes('tier') || norm.includes('range') || norm.includes('offered') || norm.includes('available')) &&
    !norm.includes('hours') && !norm.includes('amenit') && !norm.includes('wifi') && !norm.includes('occupan') && !norm.includes('capacit')
  ) {
    return 'topic:room_suite_categories';
  }

  // Bathroom amenities & features
  if (norm.includes('bathroom') || (norm.includes('toilet') && norm.includes('amenit')) || norm.includes('bathtub')) {
    return 'topic:bathroom_amenities';
  }

  // Room amenities (standard in-room amenities like kettle, coffee maker, safe, minibar)
  if (
    norm.includes('room') &&
    (norm.includes('amenit') || norm.includes('minibar') || norm.includes('nespresso') || norm.includes('tv'))
  ) {
    return 'topic:in_room_amenities';
  }

  // General on-site facilities & amenities (gym, pool, spa, business center, parking, lounge)
  if (
    (norm.includes('amenit') || norm.includes('facilit') || norm.includes('wellness')) &&
    (norm.includes('onsite') || norm.includes('on site') || norm.includes('property') || norm.includes('hotel') || norm.includes('recreation') || norm.includes('following')) &&
    !norm.includes('bathroom') && !norm.includes('room categor')
  ) {
    return 'topic:property_amenities';
  }

  // Wi-Fi connectivity & pricing
  if (norm.includes('wifi') || norm.includes('wi fi') || norm.includes('internet')) {
    return 'topic:wifi_connectivity';
  }

  // Room capacity & occupancy limits
  if (norm.includes('capacit') || norm.includes('occupan') || norm.includes('maximum number of guests') || norm.includes('limit per room')) {
    return 'topic:room_capacity';
  }

  // Accessible rooms & features
  if (norm.includes('accessib') || norm.includes('disabilit') || norm.includes('wheelchair') || norm.includes('ada')) {
    return 'topic:accessible_rooms';
  }

  // Connecting rooms
  if (norm.includes('connecting') || norm.includes('interconnecting') || norm.includes('inter connecting')) {
    return 'topic:connecting_rooms';
  }

  // Room rate cards, accommodation brochures, pricing sheets, price lists, catalogs
  if (
    (norm.includes('rate card') || norm.includes('rate sheet') || norm.includes('price sheet') || norm.includes('price list') || norm.includes('pricing') || norm.includes('brochure') || norm.includes('rates and tiers') || norm.includes('rates & tiers')) ||
    ((norm.includes('room') || norm.includes('accommodation')) && (norm.includes('rate') || norm.includes('pricing') || norm.includes('brochure')))
  ) {
    return 'topic:room_rates_brochure';
  }

  // General collateral / documents / catalogs across any business
  if (
    (norm.includes('catalog') || norm.includes('catalogue') || norm.includes('spec sheet') || norm.includes('pamphlet') || norm.includes('floor plan'))
  ) {
    return 'topic:collateral_document';
  }

  // Fallback to normalized alphanumeric word stem bag (stripping conversational filler, modal verbs, politeness phrases)
  const stopWords = new Set([
    'what', 'is', 'the', 'do', 'you', 'does', 'hotel', 'are', 'your', 'offer', 'provide', 'available',
    'for', 'to', 'of', 'and', 'in', 'on', 'a', 'an', 'following', 'which', 'property', 'onsite', 'on-site',
    'standard', 'full', 'range', 'list', 'offered', 'categories', 'category', 'could', 'would', 'can',
    'please', 'have', 'upload', 'attach', 'card', 'pdf', 'file', 'document'
  ]);
  const words = norm.split(' ').filter(w => w.length > 2 && !stopWords.has(w));
  return 'stem:' + words.slice(0, 4).sort().join('_');
}

export function areQuestionsDuplicates(q1: string, q2: string): boolean {
  if (!q1 || !q2) return false;
  if (normalizeQuestionText(q1) === normalizeQuestionText(q2)) return true;
  const k1 = getSemanticQuestionKey(q1);
  const k2 = getSemanticQuestionKey(q2);
  return k1 === k2;
}

/**
 * Sanitizes and cleans multiple choice option text:
 * - Fixes awkward parenthesis spacing like "( fee)" -> "(fee)" or "Pet-friendly ( fee)" -> "Pet-friendly (fee applies)"
 * - Removes dangling punctuation, trims extra spaces
 * - Capitalizes first letter cleanly
 */
export function cleanOptionLabel(option: string): string {
  if (!option) return '';
  let cleaned = option.trim();

  // Fix rogue spacing inside/around parentheses e.g. "( fee)" -> "(with fee)" or "(fee)"
  cleaned = cleaned.replace(/\(\s*fee\s*\)/gi, '(fee applies)');
  cleaned = cleaned.replace(/\(\s+/g, '(').replace(/\s+\)/g, ')');

  // Fix double spaces
  cleaned = cleaned.replace(/\s+/g, ' ');

  // Clean trailing punctuation like commas, periods, or colons
  cleaned = cleaned.replace(/[,;:]+$/, '');

  // Capitalize first character
  if (cleaned.length > 0) {
    cleaned = cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
  }

  return cleaned;
}

/**
 * Enriches options using geographical and domain context.
 * Guarantees comprehensive, realistic options instead of artificially capped 3-item lists.
 * E.g., for Malaysian properties, replaces generic "Digital wallets" with Touch 'n Go, GrabPay, DuitNow QR, Apple Pay, etc.
 */
export function enrichOptionsWithContext(question: string, options: string[], contextText: string = ''): string[] {
  const q = (question || '').toLowerCase();
  const ctx = (contextText || '').toLowerCase();
  const isMalaysia = ctx.includes('malaysia') || ctx.includes('kuala lumpur') || ctx.includes('kl') || ctx.includes('merdeka') || q.includes('merdeka') || q.includes('kuala lumpur');

  // 1. Payment Methods
  if (q.includes('payment method') || q.includes('payments') || q.includes('payment') || q.includes('accepted for')) {
    if (isMalaysia) {
      return [
        'Credit / Debit Cards (Visa, Mastercard, Amex)',
        "Touch 'n Go eWallet",
        'GrabPay',
        'DuitNow QR',
        'Apple Pay / Google Pay',
        'Cash',
        'UnionPay / Alipay / WeChat Pay',
      ];
    }
    return [
      'Credit / Debit cards',
      'Apple Pay & Google Pay',
      'Digital wallets',
      'Cash',
      'Bank transfer / Wire',
      'Cashless only',
    ];
  }

  // 2. Parking options
  if (q.includes('parking')) {
    return [
      'Complimentary self-parking',
      'Valet parking',
      'Paid on-site parking',
      'EV charging stations',
      'Off-site partner parking',
      'No parking available',
    ];
  }

  // 3. Bed types
  if (q.includes('bed') && (q.includes('configuration') || q.includes('types') || q.includes('standard'))) {
    return [
      '1 King Bed',
      '2 Twin Beds',
      '2 Queen Beds',
      'Rollaway bed available upon request',
      'Baby crib available complimentary',
    ];
  }

  // 4. Dining options
  if (q.includes('dining outlets') || (q.includes('dining') && q.includes('available'))) {
    if (ctx.includes('merdeka grill') || ctx.includes('park lounge')) {
      return [
        'Merdeka Grill',
        'Park Lounge',
        'Cacao',
        'In-Room Dining (24/7)',
        'Pool Bar',
      ];
    }
  }

  // 5. Dietary options & menus
  if (q.includes('dietary') || q.includes('halal') || q.includes('vegan') || q.includes('vegetarian') || q.includes('gluten')) {
    return [
      'Halal-certified kitchen / pork-free',
      'Vegetarian options available',
      'Vegan dishes available',
      'Gluten-free items available',
      'Dairy-free / nut allergy accommodations upon request',
      'Custom dietary requests accommodated with advance notice',
    ];
  }

  // If already has rich options, clean each
  return options.map(cleanOptionLabel);
}

/**
 * Pre-determines and prepares follow-up questions for fixed selection options (boolean / options only).
 * If the AI deems follow-ups necessary, they are immediately available with 0ms user wait time.
 * For questions where follow-ups are NOT necessary, returns empty [] so the card clears immediately.
 */
export function getPrePreparedFollowUps(
  question: string,
  selectedOption: string,
  topic?: string,
  existingFollowUpsMap?: Record<string, FollowUpSpec[]>
): FollowUpSpec[] {
  const normAnswer = (selectedOption || '').trim().toLowerCase();
  const normQ = (question || '').toLowerCase();

  // 1. If question had an explicit pre-generated follow-up map from AI generator
  if (existingFollowUpsMap) {
    // Exact or lowercase match
    for (const [optKey, specs] of Object.entries(existingFollowUpsMap)) {
      if (optKey.trim().toLowerCase() === normAnswer || normAnswer.includes(optKey.trim().toLowerCase())) {
        return specs;
      }
    }
  }

  // 2. High-value operational logic where follow-ups are deemed genuinely necessary:

  // BREAKFAST INCLUSION
  if (normQ.includes('breakfast included') || (normQ.includes('breakfast') && normQ.includes('guests'))) {
    if (normAnswer === 'no' || normAnswer.includes('fee') || normAnswer.includes('rate') || normAnswer.includes('charge')) {
      return [
        {
          question: 'What is the standard breakfast charge per person?',
          options: ['MYR 68 nett', 'MYR 98 nett', 'MYR 128 nett', 'A la carte menu prices', 'Free for kids under 6'],
          topic: 'Dining & Breakfast',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    if (normAnswer === 'yes' || normAnswer.includes('included')) {
      return [
        {
          question: 'Where is complimentary breakfast served?',
          options: ['Merdeka Grill', 'Park Lounge', 'In-Room Dining', 'All on-site dining outlets'],
          topic: 'Dining & Breakfast',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    // "Other" or custom -> no follow-up needed
    return [];
  }

  // CANCELLATION WINDOW
  if (normQ.includes('cancellation')) {
    if (normAnswer.includes('24 hours') || normAnswer.includes('48 hours') || normAnswer.includes('prior')) {
      return [
        {
          question: 'What is the cancellation penalty if cancelled within that window?',
          options: ['First night charge', 'Full stay charge', 'Forfeit deposit', '50% of total reservation'],
          topic: 'Guest Policies',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    return [];
  }

  // POOL ACCESS & CHILDREN
  if (normQ.includes('pool') && normQ.includes('child')) {
    if (normAnswer.includes('age') || normAnswer.includes('restriction')) {
      return [
        {
          question: 'What is the minimum age required for independent pool access?',
          options: ['12 years and above', '16 years and above', '18 years and above', 'All ages must have adult'],
          topic: 'Guest Amenities & Wellness',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    return [];
  }

  // DINING OUTLETS / RESTAURANTS (Multi-select or single)
  if (normQ.includes('dining outlets') || (normQ.includes('dining') && normQ.includes('available'))) {
    // If user confirmed Merdeka Grill or multiple restaurants, ask if reservations are required
    if (normAnswer.includes('merdeka grill') || normAnswer.includes('park lounge')) {
      return [
        {
          question: 'Are advance reservations required for on-site dining?',
          options: ['Reservations required', 'Walk-ins welcome', 'Recommended on weekends', 'Exclusive to in-house guests'],
          topic: 'Dining & Breakfast',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    return [];
  }

  // PARKING
  if (normQ.includes('parking')) {
    if (normAnswer.includes('valet') || normAnswer.includes('paid')) {
      return [
        {
          question: 'What is the parking rate for in-house hotel guests?',
          options: ['Complimentary validation', 'Flat rate (MYR 10/entry)', 'MYR 30 per day', 'Charged per hour'],
          topic: 'Guest Services & Transport',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    return [];
  }

  // PET POLICY
  if (normQ.includes('pet')) {
    if (normAnswer.includes('fee') || normAnswer.includes('pet-friendly') || normAnswer.includes('yes')) {
      return [
        {
          question: 'What is the nightly pet fee or pet weight limit?',
          options: ['MYR 150 cleaning fee per stay', 'Under 10kg only', 'Dogs and cats allowed (max 2 pets)', 'Guide / service dogs only (free)'],
          topic: 'Guest Policies',
          inputType: 'options',
          allowMultiple: false,
        },
      ];
    }
    return [];
  }

  // For questions where followups are NOT deemed necessary, return empty list!
  return [];
}

/**
 * Validates whether a text string is actually a legitimate business clarification question.
 * Rejects greetings, pleasantries, non-inquiries, empty queries, or bot pleasantries (e.g., "How can I assist you today?").
 */
export function isValidClarificationQuestion(question: string, originalQuery: string = ''): boolean {
  if (!question || typeof question !== 'string') return false;
  const q = question.trim().toLowerCase();
  const orig = originalQuery.trim().toLowerCase();

  // 1. If original message is simply a greeting / pleasantry, it is NOT an unanswered business question!
  const greetingPatterns = [
    /^(hi|hello|hey|good morning|good afternoon|good evening|howdy|hola|greetings)[\s!.,?]*$/i,
    /^(thanks|thank you|ok|okay|noted|sounds good|cool|alright|bye|goodbye)[\s!.,?]*$/i,
    /^(test|testing|hello\?|hi\?)[\s!.,?]*$/i,
  ];
  if (greetingPatterns.some(p => p.test(orig)) || greetingPatterns.some(p => p.test(q))) {
    return false;
  }

  // 2. Reject generic bot pleasantries and assistant greetings framed as questions
  const botGreetings = [
    'how can i assist you today',
    'how can i help you today',
    'how can i assist you',
    'how can i help you',
    'what can i help you with',
    'how may i assist you',
    'how may i help you',
    'what brings you to us today',
    'is there anything else i can help you with',
    'how should krayn ai respond to "hi"',
    'how should krayn ai respond to "hello"',
    'how should we respond to "hi"',
    'how should we respond to "hello"'
  ];
  if (botGreetings.some(bg => q.includes(bg))) {
    return false;
  }

  // 3. Must be at least 8 characters
  if (q.length < 8) return false;

  return true;
}


