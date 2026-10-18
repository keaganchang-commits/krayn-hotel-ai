'use client';

import React, { useState } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  Search,
  Mail,
  Phone,
  Calendar,
  Sparkles,
  Bed,
  Utensils,
  Clock,
  CheckCircle2,
  ChevronRight,
  User,
  Heart,
  MessageSquare,
  HelpCircle,
  Mic,
  FileText,
  Cake,
  Users
} from 'lucide-react';

interface InteractionHistory {
  id: string;
  type: 'email' | 'whatsapp' | 'stay';
  title: string;
  date: string;
  channel: string;
  summary: string;
  automatedAction?: string;
}

interface ProfileFact {
  area: 'Dietary & Allergies' | 'Arrival & Check-in' | 'Room Setup' | 'Transportation & Parking' | 'Billing & Folio' | 'Service Dislikes' | 'Spa & Wellness';
  topic: string;
  detail: string;
}

interface CustomerProfile {
  id: string;
  name: string;
  avatar: string;
  email: string;
  phone: string;
  vipTier: 'Gold' | 'Silver' | 'Bronze';
  totalStays: number;
  totalNights: number;
  totalSpend: string;
  avgNightlyRate: string;
  lastStay: string;
  nextUpcomingBooking?: string;
  birthday?: string;
  anniversary?: string;
  family?: string;
  profileFacts: ProfileFact[];
}

// Customer Profiles Data - High-impact, realistic hotel facts that guests actually message/call about
const CUSTOMERS: CustomerProfile[] = [
  {
    id: 'cust-1',
    name: 'Priya Sharma',
    avatar: 'PS',
    email: 'priya.sharma@gmail.com',
    phone: '+60 12-345 6789',
    vipTier: 'Gold',
    totalStays: 6,
    totalNights: 12,
    totalSpend: 'RM 18,000',
    avgNightlyRate: 'RM 1,500 / night',
    lastStay: 'Apr 12 - Apr 15, 2026',
    nextUpcomingBooking: 'Nov 02 - Nov 05, 2026',
    birthday: 'Jul 14',
    anniversary: 'Nov 04',
    family: 'Husband & 10mo infant',
    profileFacts: [
      {
        area: 'Spa & Wellness',
        topic: 'Prefers Female Therapist',
        detail: 'Always requests a certified female therapist for massage treatments.',
      },
      {
        area: 'Dietary & Allergies',
        topic: 'Severe Nut Allergy',
        detail: 'Allergic to peanuts, pecans, and walnuts. Keep kitchen surfaces and food completely nut-free.',
      },
      {
        area: 'Dietary & Allergies',
        topic: 'Halal Meals Only',
        detail: 'Eats only Halal food. No alcohol or cooking wine in dishes.',
      },
      {
        area: 'Room Setup',
        topic: 'Baby Cot & Sterilizer',
        detail: 'Place a baby cot with fresh sheets and a bottle sterilizer in the room before check-in.',
      },
      {
        area: 'Room Setup',
        topic: 'Away From Elevators',
        detail: 'Needs a quiet room far from elevators and ice machines.',
      },
      {
        area: 'Arrival & Check-in',
        topic: 'Late Checkout at 2 PM',
        detail: 'Usually needs late checkout until 2:00 PM for afternoon flights.',
      },
      {
        area: 'Transportation & Parking',
        topic: 'Airport Pickup (KLIA T1)',
        detail: 'Always books the hotel Mercedes sedan for airport pickup and drop-off.',
      },
      {
        area: 'Billing & Folio',
        topic: 'Bill to Company Account',
        detail: 'Charge stay directly to her registered corporate account and email the receipt to finance.',
      },
      {
        area: 'Service Dislikes',
        topic: 'No Wake-up Calls',
        detail: 'Do not make morning wake-up calls or promo calls to the room.',
      },
    ],
  },
  {
    id: 'cust-2',
    name: 'Michael Chen',
    avatar: 'MC',
    email: 'mchen@gmail.com',
    phone: '+65 9123 4567',
    vipTier: 'Silver',
    totalStays: 4,
    totalNights: 8,
    totalSpend: 'RM 11,200',
    avgNightlyRate: 'RM 1,400 / night',
    lastStay: 'Mar 28 - Mar 31, 2026',
    nextUpcomingBooking: 'Dec 14 - Dec 16, 2026',
    birthday: 'Sep 28',
    family: 'Solo traveler (business)',
    profileFacts: [
      {
        area: 'Dietary & Allergies',
        topic: 'Pescatarian (No Shellfish)',
        detail: 'Eats fish and vegetables. Strictly no prawns, crab, oysters, or red meat.',
      },
      {
        area: 'Service Dislikes',
        topic: 'No Luggage Porter',
        detail: 'Travels with a carry-on bag only and carries his own luggage.',
      },
      {
        area: 'Arrival & Check-in',
        topic: 'Mobile Key Only',
        detail: 'Uses digital key on phone to go straight to his room without lobby check-in.',
      },
      {
        area: 'Room Setup',
        topic: 'Quiet Corner Room',
        detail: 'Wants a high-floor corner room with full blackout curtains for video calls.',
      },
      {
        area: 'Billing & Folio',
        topic: 'Auto-charge AMEX',
        detail: 'Do not ask for a physical card at the desk; charge the AMEX on file.',
      },
      {
        area: 'Service Dislikes',
        topic: 'Skip Turn-down Service',
        detail: 'Do not knock for evening turn-down unless he asks for it.',
      },
    ],
  },
  {
    id: 'cust-3',
    name: 'Emily Watson',
    avatar: 'EW',
    email: 'emily.watson@outlook.com',
    phone: '+44 7700 900123',
    vipTier: 'Bronze',
    totalStays: 3,
    totalNights: 4,
    totalSpend: 'RM 4,800',
    avgNightlyRate: 'RM 1,200 / night',
    lastStay: 'Feb 14 - Feb 18, 2026',
    birthday: 'Mar 19',
    family: 'Traveling with partner',
    profileFacts: [
      {
        area: 'Dietary & Allergies',
        topic: 'Gluten-Free (Celiac)',
        detail: 'Has celiac disease. Needs gluten-free bread toasted in a separate toaster.',
      },
      {
        area: 'Dietary & Allergies',
        topic: 'Oat or Almond Milk Only',
        detail: 'Drinks only oat or almond milk. No dairy milk or dairy creamer.',
      },
      {
        area: 'Room Setup',
        topic: '10 Wooden Hangers & Iron',
        detail: 'Leave at least 10 wooden hangers and an ironing board in the wardrobe.',
      },
      {
        area: 'Transportation & Parking',
        topic: 'Grab Pickup at Driveway',
        detail: 'Takes Grab instead of hotel cars; concierges can direct drivers to main pickup.',
      },
      {
        area: 'Service Dislikes',
        topic: 'No Room Scents or Diffusers',
        detail: 'Sensitive to smells. Do not spray air freshener or use reed diffusers in the room.',
      },
    ],
  },
  {
    id: 'cust-4',
    name: 'Ahmad Iskandar',
    avatar: 'AI',
    email: 'ahmad.iskandar@gmail.com',
    phone: '+60 19-888 9999',
    vipTier: 'Gold',
    totalStays: 10,
    totalNights: 15,
    totalSpend: 'RM 27,000',
    avgNightlyRate: 'RM 1,800 / night',
    lastStay: 'May 02 - May 06, 2026',
    nextUpcomingBooking: 'Aug 24 - Aug 28, 2026',
    birthday: 'Jan 05',
    anniversary: 'Aug 18',
    family: 'Wife & 2 children',
    profileFacts: [
      {
        area: 'Arrival & Check-in',
        topic: 'VIP In-Suite Check-in',
        detail: 'Duty manager greets at car arrival and checks guest in directly inside the suite.',
      },
      {
        area: 'Transportation & Parking',
        topic: 'Basement 1 Parking Bay',
        detail: 'Reserve a parking spot in basement 1 next to the lift lobby.',
      },
      {
        area: 'Dietary & Allergies',
        topic: 'Halal In-Room Dining',
        detail: 'Strictly Halal food. Prefers private dining served in the room.',
      },
      {
        area: 'Room Setup',
        topic: 'Connecting Room for Kids',
        detail: 'Always books a connecting twin room for his children during August school holidays.',
      },
      {
        area: 'Billing & Folio',
        topic: 'Send Bill to Assistant',
        detail: 'Send the stay bill directly to his personal assistant via email.',
      },
      {
        area: 'Service Dislikes',
        topic: 'No Photos or Filming in Lobby',
        detail: 'Strict privacy: staff must ensure no photos or videos are taken near him in public areas.',
      },
    ],
  },
];

export default function ProfilesPage() {
  const [selectedCustomerId, setSelectedCustomerId] = useState<string>(CUSTOMERS[0].id);
  const [searchQuery, setSearchQuery] = useState('');

  const selectedCustomer = CUSTOMERS.find(c => c.id === selectedCustomerId) || CUSTOMERS[0];

  const filteredCustomers = CUSTOMERS.filter(c => {
    return (
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.email.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.phone.includes(searchQuery)
    );
  });

  return (
    <div className="flex h-screen bg-white font-sans antialiased text-[#1D1D1F] overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col lg:flex-row h-full bg-white relative overflow-hidden">
        {/* Client Directory Sidebar */}
        <aside className="w-full lg:w-80 xl:w-96 border-b lg:border-b-0 lg:border-r border-gray-200/90 flex flex-col h-auto lg:h-full bg-white shrink-0">
          {/* Search & Filters */}
          <div className="p-4 border-b border-gray-100 bg-white space-y-3 shrink-0">
            {/* Search Bar - matching WhatsApp test textbox UI/UX */}
            <div className="relative">
              <Search className="w-4 h-4 text-gray-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                placeholder="Search customers..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                className="w-full min-h-[44px] pl-10 pr-4 rounded-2xl bg-white border border-[#E5E5E7] text-xs sm:text-[13px] font-medium text-gray-900 placeholder:text-gray-400 outline-none shadow-none focus:border-gray-300 transition-colors"
              />
            </div>
          </div>

          {/* Scrollable Customer List */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100/80 p-2 space-y-1 bg-white">
            {filteredCustomers.map(customer => {
              const isSelected = customer.id === selectedCustomer.id;
              return (
                <button
                  key={customer.id}
                  type="button"
                  onClick={() => setSelectedCustomerId(customer.id)}
                  className={`w-full p-3 rounded-xl transition-all cursor-pointer text-left flex items-center justify-between gap-2.5 border ${
                    isSelected
                      ? 'border-gray-200 bg-gray-50/70 shadow-xs'
                      : 'border-transparent hover:bg-gray-50/50'
                  }`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold shrink-0 transition-colors ${
                        isSelected
                          ? 'bg-gray-900 text-white'
                          : 'bg-gray-100 text-gray-700'
                      }`}
                    >
                      {customer.avatar}
                    </div>
                    <div className="min-w-0">
                      <p className={`text-xs font-bold truncate ${isSelected ? 'text-gray-900' : 'text-gray-800'}`}>
                        {customer.name}
                      </p>
                      <p className="text-[11px] text-gray-400 truncate">
                        {customer.email}
                      </p>
                    </div>
                  </div>

                  <span
                    className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full shrink-0 border-0 ${
                      customer.vipTier === 'Gold'
                        ? 'bg-[#EAB308] text-white'
                        : customer.vipTier === 'Silver'
                        ? 'bg-[#94A3B8] text-white'
                        : 'bg-[#EA580C] text-white'
                    }`}
                  >
                    {customer.vipTier}
                  </span>
                </button>
              );
            })}

            {filteredCustomers.length === 0 && (
              <div className="py-8 text-center text-xs text-gray-400">
                No customers found matching &quot;{searchQuery}&quot;
              </div>
            )}
          </div>
        </aside>

        {/* Detail Pane: Knowledge & Memory for Selected Customer */}
        <div className="flex-1 overflow-y-auto h-full p-4 sm:p-6 lg:p-7 space-y-6">
          {/* Quick Info Cards: Clean White Cards with Subtle Borders */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3.5">
            {/* Card 1: Phone & Email */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200/90 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Contact Info
              </span>
              <div className="space-y-1.5 min-w-0">
                <p className="text-xs font-semibold text-gray-900 flex items-center gap-2 truncate">
                  <Phone className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="truncate">{selectedCustomer.phone}</span>
                </p>
                <p className="text-xs text-gray-600 flex items-center gap-2 truncate">
                  <Mail className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="truncate">{selectedCustomer.email}</span>
                </p>
              </div>
            </div>

            {/* Card 2: Nights & Spend */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200/90 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Nights &amp; Spend
              </span>
              <div className="flex items-baseline justify-between gap-1.5 pt-1">
                <span className="text-base font-bold text-gray-900">
                  {selectedCustomer.totalNights} Nights
                </span>
                <span className="text-sm font-bold text-gray-900">
                  {selectedCustomer.totalSpend}
                </span>
              </div>
            </div>

            {/* Card 3: Family & Companion */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200/90 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Family &amp; Companion
              </span>
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 flex items-center gap-2 truncate">
                  <Users className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                  <span className="truncate">{selectedCustomer.family || 'Solo traveler'}</span>
                </p>
                <p className="text-[11px] text-gray-400 font-medium truncate">
                  Last: {selectedCustomer.lastStay}
                </p>
              </div>
            </div>

            {/* Card 4: Upcoming & Important Dates */}
            <div className="p-4 rounded-2xl bg-white border border-gray-200/90 space-y-2">
              <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block">
                Next Stay &amp; Dates
              </span>
              <div className="space-y-1 min-w-0">
                <p className="text-xs font-semibold text-gray-900 flex items-center gap-2 truncate">
                  <Clock className="w-3.5 h-3.5 text-gray-500 shrink-0" />
                  <span className="truncate">{selectedCustomer.nextUpcomingBooking || 'No upcoming stay'}</span>
                </p>
                <p className="text-[11px] text-gray-500 truncate">
                  <span>Birthday: {selectedCustomer.birthday || 'Not set'}</span>
                  {selectedCustomer.anniversary && (
                    <>
                      <span className="mx-1.5">•</span>
                      <span>Anniv: {selectedCustomer.anniversary}</span>
                    </>
                  )}
                </p>
              </div>
            </div>
          </div>

          {/* Section: Knowledge & Memory matching the Knowledge Page table */}
          {(() => {
            // Sort profile facts logically by area priority
            const areaPriority: Record<string, number> = {
              'Dietary & Allergies': 1,
              'Arrival & Check-in': 2,
              'Room Setup': 3,
              'Transportation & Parking': 4,
              'Billing & Folio': 5,
              'Service Dislikes': 6,
            };

            const sortedFacts = [...selectedCustomer.profileFacts].sort((a, b) => {
              const pA = areaPriority[a.area] || 99;
              const pB = areaPriority[b.area] || 99;
              return pA - pB;
            });

            return (
              <div className="w-full space-y-1">
                {/* Header with Title and Count badge matching the image */}
                <div className="flex items-center justify-between pb-0.5">
                  <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                    <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900 flex items-center gap-1.5">
                      <span>Knowledge &amp; Memory</span>
                    </h3>
                    <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                      {sortedFacts.length}
                    </span>
                  </div>
                </div>

                {/* Clean flat outer border container wrapping all rows - exactly matching Knowledge page */}
                <div className="w-full rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none">
                  <div className="divide-y divide-gray-100 px-4 sm:px-6">
                    {sortedFacts.map((fact, idx) => (
                      <div key={idx} className="w-full py-3.5 sm:py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                          {/* Column 1: Topic / Title in a single clean row */}
                          <div className="sm:col-span-4 lg:col-span-3 pr-2">
                            <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                              {fact.topic}
                            </span>
                          </div>

                          {/* Column 2: Detail */}
                          <div className="sm:col-span-8 lg:col-span-9 pr-2">
                            <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                              {fact.detail}
                            </p>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            );
          })()}
        </div>
      </main>
    </div>
  );
}
