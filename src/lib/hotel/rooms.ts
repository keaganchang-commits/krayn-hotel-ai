/**
 * Official Verified Room & Suite Inventory for Park Hyatt Kuala Lumpur
 * Levels 100 to 112 (Total: 252 guestrooms and suites; 27 suites)
 * 
 * ONLY these room types physically exist at the property. No villas, bungalows, cottages,
 * cabins, penthouses, or ocean view rooms exist.
 */

export interface OfficialRoomType {
  id: string;
  category: 'room' | 'suite';
  name: string;
  sizeSqm: string;
  bedOptions: string[];
  keyFeatures: string;
}

export const OFFICIAL_PARK_HYATT_ROOMS: OfficialRoomType[] = [
  // Guestrooms (Levels 100-112)
  {
    id: 'standard_room',
    category: 'room',
    name: 'Standard Room',
    sizeSqm: '53-59 sqm',
    bedOptions: ['1 King Bed', '2 Twin Beds'],
    keyFeatures: 'Floor-to-ceiling city views, marble bathroom with freestanding soaking tub, Nespresso machine',
  },
  {
    id: 'tower_view_room',
    category: 'room',
    name: 'Tower View Room',
    sizeSqm: '53-59 sqm',
    bedOptions: ['1 King Bed', '2 Twin Beds'],
    keyFeatures: 'Direct unobstructed views of the Petronas Twin Towers, luxury deep soaking bathtub',
  },
  {
    id: 'corner_king_room',
    category: 'room',
    name: 'Corner King Room',
    sizeSqm: '57-69 sqm',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Dual-aspect panoramic city skyline vistas, walk-in dressing wardrobe',
  },
  {
    id: 'deluxe_room',
    category: 'room',
    name: 'Deluxe Room',
    sizeSqm: '58-83 sqm',
    bedOptions: ['1 King Bed', '2 Twin Beds'],
    keyFeatures: 'Expansive open-plan living and sleeping layout, powder room, walk-in dressing area',
  },
  {
    id: 'king_studio',
    category: 'room',
    name: 'King Studio',
    sizeSqm: '74-79 sqm',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Residential-style luxury studio layout with separate lounge seating area and workstation',
  },

  // Suites (Levels 100-112)
  {
    id: 'park_suite',
    category: 'suite',
    name: 'Park Suite',
    sizeSqm: '104-115 sqm',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Separate living salon, private powder room, spacious walk-in dressing area, luxury bathroom',
  },
  {
    id: 'park_deluxe_suite',
    category: 'suite',
    name: 'Park Deluxe Suite',
    sizeSqm: '115 sqm',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Corner suite layout with panoramic Merdeka 118 views, powder room, dining and living areas',
  },
  {
    id: 'park_executive_suite',
    category: 'suite',
    name: 'Park Executive Suite',
    sizeSqm: 'Up to 150 sqm',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Expansive entertaining living room, executive dining area, wet bar, master bathroom retreat',
  },
  {
    id: 'diplomatic_suite',
    category: 'suite',
    name: 'Diplomatic Suite',
    sizeSqm: 'Multi-room luxury suite',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'Multi-room presidential-tier residence with Miele kitchenette, private dining salon, skyline panorama',
  },
  {
    id: 'presidential_suite',
    category: 'suite',
    name: 'Presidential Suite',
    sizeSqm: 'Top-tier luxury penthouse floorplan',
    bedOptions: ['1 King Bed'],
    keyFeatures: 'The crown suite of Park Hyatt Kuala Lumpur with private gym, private entry foyer, 75-inch QLED display, master spa bathroom',
  },
];

export const OFFICIAL_ROOM_PROMPT_INSTRUCTION = `OFFICIAL VERIFIED ROOMS & SUITES (PARK HYATT KUALA LUMPUR - LEVELS 100 TO 112):
The hotel exclusively features 252 guestrooms and 27 suites across these EXACT official types:
• Rooms: Standard Room (53-59 sqm), Tower View Room (53-59 sqm with Petronas Towers view), Corner King Room (57-69 sqm), Deluxe Room (58-83 sqm), and King Studio (74-79 sqm).
• Suites: Park Suite (104-115 sqm), Park Deluxe Suite (115 sqm), Park Executive Suite (up to 150 sqm), Diplomatic Suite, and Presidential Suite.
• Bed configurations: 1 King Bed or 2 Twin Beds. Rollaway beds upon request; complimentary baby cribs.
• CRITICAL: NEVER invent, hallucinate, or mention non-existent room types such as villas, bungalows, cottages, chalets, cabins, garden suites, or ocean view rooms. The hotel is an ultra-luxury skyscraper hotel situated inside Menara Merdeka 118.`;
