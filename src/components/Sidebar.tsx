'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, GraduationCap, MessageSquare, Mic } from 'lucide-react';

function SidebarInner({
  syncedEmailsCount = 4006,
  statusMessage,
  onUploadPdf,
  isSyncing = false,
  isUploading = false,
  onCompose,
}: {
  syncedEmailsCount?: number;
  statusMessage?: string | null;
  onUploadPdf?: () => void;
  isSyncing?: boolean;
  isUploading?: boolean;
  onCompose?: () => void;
} = {}) {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const currentMode = searchParams.get('mode') || 'teach';

  const isChatActive = pathname === '/chat';
  const [isChatDropdownOpen, setIsChatDropdownOpen] = useState(isChatActive);

  // Auto-expand dropdown when navigating to /chat
  useEffect(() => {
    if (pathname === '/chat') {
      setIsChatDropdownOpen(true);
    }
  }, [pathname]);

  const navItems = [
    { label: 'Knowledge', href: '/knowledge' },
    { label: 'Clarifications', href: '/clarifications' },
    { label: 'Live Calls', href: '/copilot' },
    { label: 'Customer Profiles', href: '/profiles' },
    { label: 'Voice Training', href: '/voice' },
  ];

  return (
    <aside className="w-40 md:w-44 bg-white border-r border-[#E5E5E7] flex flex-col justify-between p-2.5 md:p-3 z-10 shrink-0 transition-all">
      <div>
        {/* Logo & Brand - Centered, Crisp Apple proportions with tighter top spacing */}
        <Link href="/knowledge" className="flex items-center justify-center py-1.5 px-1 mb-2">
          <img
            src="/logo.png"
            alt="Krayn"
            className="w-auto h-8 md:h-9 max-w-[130px] object-contain"
          />
        </Link>

        {/* Navigation Items */}
        <nav className="space-y-0.5">
          {navItems.map(item => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`w-full flex items-center px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  isActive
                    ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
                    : 'text-gray-600 font-normal hover:bg-gray-50 hover:text-black'
                }`}
                title={item.label}
              >
                <span className="truncate">{item.label}</span>
              </Link>
            );
          })}

          {/* AI Chat Item with Dropdown (swapped above Settings) */}
          <div className="pt-0.5">
            <button
              type="button"
              onClick={() => setIsChatDropdownOpen(prev => !prev)}
              className={`w-full flex items-center justify-between px-2.5 py-2 rounded-lg text-xs transition-colors cursor-pointer ${
                isChatActive
                  ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
                  : 'text-gray-600 font-normal hover:bg-gray-50 hover:text-black'
              }`}
              title="AI Chat"
            >
              <span className="truncate">AI Chat</span>
              <ChevronDown
                className={`w-3.5 h-3.5 text-gray-400 transition-transform duration-200 ${
                  isChatDropdownOpen ? 'rotate-180 text-gray-700' : ''
                }`}
              />
            </button>

            {/* Dropdown items for Teach and Test */}
            {isChatDropdownOpen && (
              <div className="mt-0.5 ml-2 pl-2 border-l border-[#E5E5E7] space-y-0.5 animate-in fade-in slide-in-from-top-1 duration-150">
                <Link
                  href="/chat?mode=teach"
                  className={`w-full flex items-center px-2 py-1 rounded-md text-[11.5px] transition-colors ${
                    isChatActive && currentMode === 'teach'
                      ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
                      : 'text-gray-600 hover:text-black hover:bg-gray-50 font-normal'
                  }`}
                >
                  <span className="truncate">Teach AI</span>
                </Link>

                <Link
                  href="/chat?mode=test&channel=whatsapp"
                  className={`w-full flex items-center px-2 py-1 rounded-md text-[11.5px] transition-colors ${
                    isChatActive && currentMode === 'test' && (searchParams.get('channel') === 'whatsapp' || !searchParams.get('channel'))
                      ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
                      : 'text-gray-600 hover:text-black hover:bg-gray-50 font-normal'
                  }`}
                >
                  <span className="truncate">WhatsApp Test</span>
                </Link>

                <Link
                  href="/chat?mode=test&channel=email"
                  className={`w-full flex items-center px-2 py-1 rounded-md text-[11.5px] transition-colors ${
                    isChatActive && currentMode === 'test' && searchParams.get('channel') === 'email'
                      ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
                      : 'text-gray-600 hover:text-black hover:bg-gray-50 font-normal'
                  }`}
                >
                  <span className="truncate">Email Test</span>
                </Link>
              </div>
            )}
          </div>
        </nav>
      </div>

      {/* Settings Item pinned at the very bottom */}
      <div className="pt-2 border-t border-[#E5E5E7]/70">
        <Link
          href="/settings"
          className={`w-full flex items-center px-2.5 py-2 rounded-lg text-xs transition-colors ${
            pathname === '/settings'
              ? 'bg-white text-black font-semibold border border-[#E5E5E7] shadow-xs'
              : 'text-gray-600 font-normal hover:bg-gray-50 hover:text-black'
          }`}
          title="Settings"
        >
          <span className="truncate">Settings</span>
        </Link>
      </div>
    </aside>
  );
}

export default function Sidebar(props: any) {
  return (
    <React.Suspense fallback={<aside className="w-40 md:w-44 bg-white border-r border-[#E5E5E7] p-3" />}>
      <SidebarInner {...props} />
    </React.Suspense>
  );
}
