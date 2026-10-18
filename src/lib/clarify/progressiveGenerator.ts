import { getGeminiClient, GEMINI_GENERATIVE_MODELS } from '@/lib/ai/gemini';
import { vectorStore } from '@/lib/vector/store';
import { normalizeQuestionText, getSemanticQuestionKey } from './seedQuestions';

export interface ProgressiveQuestion {
  question: string;
  topic: string;
  options: string[];
  inputType?: 'options' | 'text' | 'file' | 'boolean';
  placeholder?: string;
  priorityScore?: number;
  allowMultiple?: boolean;
}

/**
 * Generates clustered clarification questions following a strict Progressive Business Depth Matrix:
 *
 * Tier 1: Core Business Archetype & Identity (Business type, primary model, target customer)
 * Tier 2: Tangible Offerings, Facilities, Menus, Products & Physical/Digital Scope
 *         (e.g., for Hotel: restaurant names & cuisines, room categories & capacities, amenities like pool/spa/gym, parking, breakfast options)
 *         (e.g., for Clinic: treatments offered, doctor specialties, consultation pricing, insurance acceptance)
 *         (e.g., for E-commerce: product catalog categories, bestsellers, inventory lead times, sizing)
 * Tier 3: Service Delivery, Booking/Ordering Logistics, Hours & Pricing Details
 * Tier 4: Edge Cases, Complex Exceptions & Escalation Policies (Complaints, corporate deals, disputes, special exceptions)
 *
 * Always generates questions in clusters of 2-3 questions per cohesive topic with flexible, dynamic topic titles.
 */
export async function generateProgressiveQuestions(): Promise<ProgressiveQuestion[]> {
  const ai = getGeminiClient();
  if (!ai) return [];

  const allItems = await vectorStore.listItems();
  const confirmedItems = allItems.filter(i => i.source !== 'clarification');

  if (confirmedItems.length === 0) return [];

  const confirmedKnowledge = confirmedItems
    .slice(0, 20)
    .map(i => `[${i.source.toUpperCase()}: ${i.title}] ${i.text}`)
    .join('\n\n');

  // Collect already answered questions
  const answeredQuestionNorms = new Set<string>();
  for (const item of allItems) {
    if (item.source === 'user_teaching') {
      if (item.metadata?.question) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.question)));
      if (item.metadata?.resolvedQuestion) answeredQuestionNorms.add(normalizeQuestionText(String(item.metadata.resolvedQuestion)));
      const match = item.text.match(/Regarding ["']?([^"',\n]+)["']?,/i);
      if (match && match[1]) answeredQuestionNorms.add(normalizeQuestionText(match[1]));
    }
  }

  // Active clarification items
  const activeItems = allItems.filter(i => i.source === 'clarification');
  const activeNorms = new Set(
    activeItems.map(i => normalizeQuestionText(String(i.metadata?.question || i.text || '')))
  );
  const activeSemanticKeys = new Set(
    activeItems.map(i => getSemanticQuestionKey(String(i.metadata?.question || i.text || '')))
  );
  const answeredSemanticKeys = new Set<string>();
  for (const item of allItems) {
    if (item.source === 'user_teaching') {
      if (item.metadata?.question) answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.question)));
      if (item.metadata?.resolvedQuestion) answeredSemanticKeys.add(getSemanticQuestionKey(String(item.metadata.resolvedQuestion)));
    }
  }

  const prompt = `You are Krayn AI, an expert business analyst and operations auditor.
Analyze the confirmed business knowledge below. Your mission is to systematically and progressively learn EVERYTHING about this business, starting from the tangible basic details before jumping to edge cases.

CONFIRMED KNOWLEDGE:
${confirmedKnowledge}

CRITICAL ARCHITECTURE DIRECTIVE:
    - UNIVERSAL CUSTOMER-CENTRICITY DIRECTIVE (APPLIES TO ALL BUSINESS TYPES):
      * ONLY ask for information that REAL CUSTOMERS actually ask about (e.g. concrete pricing/rates, exact operating hours, booking/order procedures, package inclusions, cancellation policies, deliverables, turnaround times, and specific menu/catalog/brochure files).
      * NEVER ask owners abstract, subjective, or theoretical essay questions about their "culinary concept", "design philosophy", "thematic style", "brand ethos", or "specialty focus". Customers never ask for abstract themes — they ask for the MENU, the PRICELIST, the SERVICE SHEET, or the RATE CARD.
      * When you need details about offerings, services, or products, ASK FOR THE CONCRETE DOCUMENT (menu, price list, service guide, brochure) with inputType "file"! The AI can then extract the details directly and only ask simple, high-confidence YES/NO confirmations to verify assumptions.
      * If it is a HOTEL/HOSPITALITY business: Ask for specific menus, room rate tiers, check-in/out, parking rates, and pool/gym access hours.
      * If it is a RESTAURANT/CAFE: Ask for the menu PDF, operating hours, reservation requirements, and dietary certifications.
      * If it is a MEDICAL/CLINIC/HEALTH: Ask for treatment service lists, consultation fees, opening days, and insurance panels.
      * If it is a RETAIL/E-COMMERCE: Ask for product catalog, return policy days, shipping rates, and warranty terms.
      * If it is a SERVICE/AGENCY: Ask for rate card/proposal sheet, turnaround timeline, payment milestones, and revision limits.
    - UNIVERSAL MENU & DIETARY PREREQUISITE RULE:
      * NEVER ask vague questions like "Does the hotel offer specific dietary menus at these outlets?".
      * Dietary accommodations MUST ALWAYS be asked on a PER-OUTLET basis (e.g. "What dietary options are available at Merdeka Grill?").
      * NEVER ask detailed dietary or menu specialization questions for an outlet BEFORE you have requested or received its menu PDF/brochure! Ask for the menu file FIRST. Once the menu is uploaded or if the owner provides options, dietary questions should be MULTI-SELECT checklists (e.g. Halal, Vegan, Gluten-free, Vegetarian) with inputType "options" and allowMultiple: true.
    - Only AFTER the tangible offerings, products, facilities, and core operations are understood should you probe into edge-case policies.

    - SINGLE DEEP-DIVE AREA PER CYCLE (CRITICAL):
      * In this cycle, you must pick ONE specific operational area that has missing details (e.g. "Breakfast & Morning Dining", "Parking & Arrival Logistics", "Room Tiers & Bed Options", "Pool & Wellness Facilities", "Cancellation & Deposit Rules", or "Gym & Fitness Access").
      * Do NOT scatter questions across 5 different departments or areas at once.
      * Stay laser-focused on this ONE specific area, asking between 4 to a MAXIMUM OF 10 questions to thoroughly master every practical detail a customer would ask about it.
      * All questions in this cycle MUST share the same cohesive topic title representing this area.

    - STRICT OBJECTIVITY & REAL CUSTOMER INQUIRY LIKELIHOOD (CRITICAL):
      * ONLY ask for strictly objective, factual, operational information that a real paying customer is genuinely likely to ask (e.g. "What time does breakfast end?", "Is parking free or chargeable?", "Are baby cribs provided?", "What is the pet cleaning fee?").
      * NEVER ask subjective, creative, or philosophical questions (e.g. NEVER ask "What is your design vision?", "How would you describe the atmosphere?", "What is the culinary philosophy?").
      * When menus, brochures, or catalogs are involved, request the file with inputType "file".
      * Keep every question atomic (asking about only ONE policy or outlet at a time).

3. STRICT STYLE RULES FOR QUESTIONS & OPTIONS:
    - ATOMICITY:
      * NEVER combine two distinct entities, outlets, or aspects into one question.
      * Keep questions direct, plain, and quick to grasp.
    - OPTIONS & LOCAL CONTEXT:
      * Provide realistic, well-formatted options (3 to 7+ options). Include local market specifics (e.g., Touch 'n Go, GrabPay, MYR currency if in Malaysia).
      * When "inputType" is "text" or "file", keep "options": [].
      * For "boolean", provide ["Yes", "No"].
      * Set "allowMultiple": true when multiple choices can coexist (e.g. amenities, accepted payment methods). Set false for mutually exclusive choices.

4. INPUT TYPE DETERMINATION ("inputType"):
    - "boolean": For simple Yes / No questions. Options: ["Yes", "No"].
    - "text": Open text input for exact operating hours, contact numbers, email addresses, specific rates/fees. Options: []. Provide placeholder.
    - "file": Multiple/single PDF or image upload for menus, catalogs, price brochures, floor plans, rate cards. Options: [].
    - "options": Multiple-choice selection with however many options are natural.

Return strictly a JSON array of up to 10 questions focusing on that ONE single specific area:
[
  {
    "topic": "Breakfast & Morning Dining",
    "question": "What time is breakfast served on weekdays?",
    "inputType": "text",
    "placeholder": "e.g., 6:30 AM - 10:30 AM",
    "options": []
  },
  {
    "topic": "Breakfast & Morning Dining",
    "question": "Is breakfast complimentary for in-house guests?",
    "inputType": "boolean",
    "allowMultiple": false,
    "options": ["Yes", "No"]
  },
  {
    "topic": "Breakfast & Morning Dining",
    "question": "What type of breakfast service is provided?",
    "inputType": "options",
    "allowMultiple": true,
    "options": ["Full International Buffet", "A la carte menu", "Continental set", "Grab-and-go boxes", "Halal-certified options"]
  }
]`;

  const modelsToTry = GEMINI_GENERATIVE_MODELS;
  for (const model of modelsToTry) {
    try {
      const res = await ai.models.generateContent({ model, contents: prompt });
      const text = res.text?.trim() || '';
      const match = text.match(/\[[\s\S]*\]/);
      if (match) {
        const parsed: ProgressiveQuestion[] = JSON.parse(match[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          // Filter out already answered or currently active duplicate questions (both verbatim & semantic topic)
          const { isQuestionAnsweredInKnowledgeHub } = await import('./knowledgeAuditor');
          const seenInBatch = new Set<string>();
          const filtered: ProgressiveQuestion[] = [];
          for (const q of parsed) {
            const norm = normalizeQuestionText(q.question);
            const key = getSemanticQuestionKey(q.question);
            if (answeredQuestionNorms.has(norm) || activeNorms.has(norm)) continue;
            if (answeredSemanticKeys.has(key) || activeSemanticKeys.has(key)) continue;
            if (seenInBatch.has(key)) continue;

            // Check if already answered in Knowledge Hub
            const check = await isQuestionAnsweredInKnowledgeHub(q.question, confirmedItems);
            if (check.hasAnswer) continue;

            // Strictly refine inputType and allowMultiple to tailor answer types to the question
            const { inferClarificationInputType, inferClarificationMultiSelect } = await import('./seedQuestions');
            const inferred = inferClarificationInputType(q.question, q.inputType);
            const allowMulti = inferClarificationMultiSelect(q.question, q.allowMultiple);

            seenInBatch.add(key);
            filtered.push({
              ...q,
              inputType: inferred.inputType,
              placeholder: q.placeholder || inferred.placeholder,
              allowMultiple: inferred.inputType === 'boolean' ? false : allowMulti,
            });

            if (filtered.length >= 10) break;
          }
          return filtered.slice(0, 10);
        }
      }
    } catch (e: any) {
      const errMsg = e?.message || String(e);
      const is429 = e?.status === 429 || errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED');
      if (is429) {
        // Stop hammering other models when project-level daily quota is reached
        console.warn(`[Progressive Generator] Daily Gemini free-tier quota reached. Cooling down.`);
        const { markQuotaExhausted } = await import('./pregenerator');
        markQuotaExhausted();
        break;
      }
      console.warn(`[Progressive Generator] Model ${model} failed (${errMsg.slice(0, 120)}), trying next...`);
    }
  }

  return [];
}
