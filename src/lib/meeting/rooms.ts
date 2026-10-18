export interface MeetingRoomVenue {
  id: string;
  name: string;
  floor: string;
  capacityMin: number;
  capacityMax: number;
  defaultSetup: string;
  availableSetups: string[];
  description: string;
  features: string[];
}

export const PARK_HYATT_MEETING_ROOMS: MeetingRoomVenue[] = [
  {
    id: 'executive_salon_1_6',
    name: 'Executive Salons (Level 98)',
    floor: 'Level 98',
    capacityMin: 6,
    capacityMax: 18,
    defaultSetup: 'Executive Boardroom',
    availableSetups: ['Boardroom', 'U-Shape'],
    description: 'Six intimate, state-of-the-art Executive Salons located high on Level 98, tailored for executive board meetings, negotiations, and confidential strategic sessions.',
    features: [
      'Built-in 4K UHD presentation screens',
      'Integrated wireless screen sharing & video conferencing',
      'Bespoke leather executive swivel armchairs',
      'In-room continuous espresso & specialty tea station',
      'Dedicated Event Concierge support'
    ]
  },
  {
    id: 'sky_rooms_1_4',
    name: 'Sky Rooms (Level 114)',
    floor: 'Level 114',
    capacityMin: 18,
    capacityMax: 80,
    defaultSetup: 'Classroom / Boardroom',
    availableSetups: ['Boardroom', 'U-Shape', 'Classroom', 'Theater', 'Banquet'],
    description: 'Four magnificent meeting & event suites on Level 114 featuring panoramic city skyline views, adaptable modular configurations, and abundant natural daylight.',
    features: [
      'Dual high-lumen laser projectors and motorized screens',
      'Floor-to-ceiling panoramic skyline windows',
      'Adaptable acoustic room partitions',
      'Lavalier and handheld wireless sound reinforcement',
      'Private pre-function foyer for cocktail or coffee breaks'
    ]
  }
];

export function getRecommendedMeetingRoom(attendees: number = 10): MeetingRoomVenue {
  if (attendees <= 18) {
    return PARK_HYATT_MEETING_ROOMS[0]; // Level 98 Executive Salons
  }
  return PARK_HYATT_MEETING_ROOMS[1]; // Level 114 Sky Rooms
}
