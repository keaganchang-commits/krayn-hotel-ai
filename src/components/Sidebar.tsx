'use client';

import React, { useState, useEffect } from 'react';
import Link from 'next/link';
import { usePathname, useSearchParams } from 'next/navigation';
import { ChevronDown, Menu, X } from 'lucide-react';

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
  const [isMobileOpen, setIsMobileOpen] = useState(false);

  // Auto-expand dropdown when navigating to /chat
  useEffect(() => {
    if (pathname === '/chat') {
      setIsChatDropdownOpen(true);
    }
  }, [pathname]);

  // Close mobile sidebar on route change
  useEffect(() => {
    setIsMobileOpen(false);
  }, [pathname, searchParams]);

  // Prevent background body scroll when mobile sidebar drawer is open
  useEffect(() => {
    if (isMobileOpen) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [isMobileOpen]);

  // Autonomous Email Poller: Keeps autonomous scanning active on Vercel whenever dashboard is open
  useEffect(() => {
    let isMounted = true;
    const interval = setInterval(async () => {
      try {
        await fetch('/api/gmail/autoreply', { method: 'POST' });
      } catch {
        // silent
      }
    }, 4000);

    // Initial check on mount
    fetch('/api/gmail/autoreply', { method: 'POST' }).catch(() => {});

    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, []);

  const navItems = [
    { label: 'Knowledge', href: '/knowledge' },
    { label: 'Clarifications', href: '/clarifications' },
    { label: 'Live Calls', href: '/copilot' },
    { label: 'Customer Profiles', href: '/profiles' },
    { label: 'Voice Training', href: '/voice' },
  ];

  const sidebarContent = (
    <div className="flex flex-col justify-between h-full p-2.5 md:p-3">
      <div>
        {/* Top bar on mobile (with close button) / Centered Logo on Desktop */}
        <div className="flex items-center justify-between md:justify-center py-1.5 px-1 mb-2">
          <Link href="/knowledge" className="flex items-center justify-center">
            <img
              src="/logo.png"
              alt="Krayn"
              className="w-auto h-8 md:h-9 max-w-[130px] object-contain"
            />
          </Link>
          {/* Close button on mobile drawer */}
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="md:hidden p-1.5 rounded-lg text-gray-500 hover:text-black hover:bg-gray-100 transition-colors"
            aria-label="Close sidebar"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

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

          {/* AI Chat Item with Dropdown */}
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
    </div>
  );

  return (
    <>
      {/* Mobile Floating Hamburger Button (Apple style pill / circular blur button) */}
      <div className="md:hidden fixed top-3 left-3 z-40">
        <button
          type="button"
          onClick={() => setIsMobileOpen(true)}
          className="flex items-center justify-center w-9 h-9 rounded-full bg-white/95 backdrop-blur-md border border-[#E5E5E7] shadow-sm text-gray-700 hover:text-black active:scale-95 transition-all"
          aria-label="Open sidebar"
        >
          <Menu className="w-4 h-4" />
        </button>
      </div>

      {/* Mobile Backdrop Overlay */}
      {isMobileOpen && (
        <div
          onClick={() => setIsMobileOpen(false)}
          className="md:hidden fixed inset-0 bg-black/25 backdrop-blur-[2px] z-50 transition-opacity animate-in fade-in duration-200"
          aria-hidden="true"
        />
      )}

      {/* Mobile Slide-out Drawer */}
      <div
        className={`md:hidden fixed inset-y-0 left-0 w-64 max-w-[80vw] bg-white z-50 shadow-2xl border-r border-[#E5E5E7] transform transition-transform duration-300 ease-out flex flex-col ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {sidebarContent}
      </div>

      {/* Desktop Persistent Sidebar (unchanged on md and up) */}
      <aside className="hidden md:flex w-40 md:w-44 bg-white border-r border-[#E5E5E7] flex-col justify-between z-10 shrink-0 transition-all">
        {sidebarContent}
      </aside>
    </>
  );
}

export default function Sidebar(props: any) {
  return (
    <React.Suspense fallback={<aside className="w-40 md:w-44 bg-white border-r border-[#E5E5E7] p-3" />}>
      <SidebarInner {...props} />
    </React.Suspense>
  );
}
