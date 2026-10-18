'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import ComposeModal from '@/components/ComposeModal';
import EmailBodyRenderer from '@/components/EmailBodyRenderer';
import {
  Search,
  RefreshCw,
  CheckCheck,
  ArrowLeft,
  Star,
  Send
} from 'lucide-react';

interface SentEmail {
  id: string;
  threadId: string;
  subject: string;
  sender: string;
  date: string;
  snippet: string;
  body?: string;
  html?: string;
  unread: boolean;
  labels: string[];
}

export default function SentPage() {
  const router = useRouter();
  const [sentEmails, setSentEmails] = useState<SentEmail[]>([]);
  const [activeEmail, setActiveEmail] = useState<SentEmail | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoadingSent, setIsLoadingSent] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [totalMessagesCount, setTotalMessagesCount] = useState(0);

  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const observerTarget = useRef<HTMLDivElement | null>(null);

  const [isLoadingBody, setIsLoadingBody] = useState(false);

  const fetchSentPage = async (token?: string, isAppend = false) => {
    if (isAppend) {
      setIsLoadingMore(true);
    } else {
      setIsLoadingSent(true);
    }

    try {
      let url = '/api/gmail/inbox?maxResults=15&q=in:sent';
      if (token) {
        url += `&pageToken=${encodeURIComponent(token)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        setSentEmails(prev => {
          const incoming: SentEmail[] = data.emails || [];
          if (!isAppend) return incoming;
          const existingIds = new Set(prev.map(e => e.id));
          const newEmails = incoming.filter(e => !existingIds.has(e.id));
          return [...prev, ...newEmails];
        });
        setNextPageToken(data.nextPageToken);
        if (data.totalMessages) setTotalMessagesCount(data.totalMessages);
      }
    } catch (err) {
      console.error('Failed to load Gmail sent messages:', err);
    } finally {
      setIsLoadingSent(false);
      setIsLoadingMore(false);
    }
  };

  const handleSelectEmail = async (email: SentEmail) => {
    setActiveEmail(email);
    if (!email.body) {
      setIsLoadingBody(true);
      try {
        const res = await fetch(`/api/gmail/message?id=${encodeURIComponent(email.id)}`);
        const data = await res.json();
        if (data.success && (data.body || data.html)) {
          setActiveEmail(prev => (prev && prev.id === email.id ? { ...prev, body: data.body, html: data.html } : prev));
          setSentEmails(prev =>
            prev.map(e => (e.id === email.id ? { ...e, body: data.body, html: data.html } : e))
          );
        }
      } catch (err) {
        console.warn('Failed to load full sent body:', err);
      } finally {
        setIsLoadingBody(false);
      }
    }
  };

  useEffect(() => {
    fetchSentPage(undefined, false);
  }, []);

  // Infinite scroll intersection observer
  const loadMore = useCallback(() => {
    if (!isLoadingSent && !isLoadingMore && nextPageToken) {
      fetchSentPage(nextPageToken, true);
    }
  }, [isLoadingSent, isLoadingMore, nextPageToken]);

  useEffect(() => {
    const target = observerTarget.current;
    if (!target) return;

    const observer = new IntersectionObserver(
      entries => {
        if (entries[0].isIntersecting) {
          loadMore();
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(target);
    return () => observer.disconnect();
  }, [loadMore]);

  const filteredEmails = sentEmails.filter(
    e =>
      e.subject.toLowerCase().includes(searchFilter.toLowerCase()) ||
      e.sender.toLowerCase().includes(searchFilter.toLowerCase()) ||
      e.snippet.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-gray-900">
      <Sidebar onCompose={() => setIsComposeOpen(true)} />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        <ComposeModal
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
        />

        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeEmail ? (
            /* Detailed Sent Email View - Clean Minimalist Header */
            <div className="w-full px-4 sm:px-8 py-4 sm:py-6 space-y-5">
              {/* Top Action Toolbar with Back Button & Subject */}
              <div className="flex items-center gap-3 pb-1">
                <button
                  onClick={() => setActiveEmail(null)}
                  className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer shrink-0"
                  title="Back to Sent Mail"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <h1 className="text-xl sm:text-2xl font-normal text-gray-900 tracking-tight leading-snug truncate">
                  {activeEmail.subject || '(No Subject)'}
                </h1>
              </div>

              {/* Recipient Details Row */}
              {(() => {
                const rawSender = activeEmail.sender || '';
                const emailMatch = rawSender.match(/<([^>]+)>/);
                const emailAddress = emailMatch ? emailMatch[1] : (rawSender.includes('@') ? rawSender : '');
                const displayName = rawSender.replace(/<[^>]+>/, '').trim() || emailAddress || 'Recipient';
                const initial = displayName.charAt(0).toUpperCase() || 'R';

                return (
                  <div className="flex items-start justify-between gap-4 pt-2">
                    <div className="flex items-start gap-3.5 min-w-0">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-emerald-700 text-white flex items-center justify-center font-medium text-base shrink-0 select-none shadow-2xs">
                        {initial}
                      </div>

                      {/* Recipient Info */}
                      <div className="min-w-0 text-[13px] leading-tight space-y-1">
                        <div className="flex flex-wrap items-baseline gap-1.5">
                          <span className="font-bold text-gray-900">To: {displayName}</span>
                          {emailAddress && emailAddress !== displayName && (
                            <span className="text-gray-500 font-normal">&lt;{emailAddress}&gt;</span>
                          )}
                        </div>
                        <div className="text-gray-500 text-xs flex items-center gap-1 font-normal">
                          <span>from me</span>
                          <span className="text-[10px] text-gray-400">▾</span>
                        </div>
                      </div>
                    </div>

                    {/* Timestamp */}
                    <div className="flex items-center gap-3 shrink-0 pt-0.5">
                      <span className="text-xs text-gray-500 font-normal whitespace-nowrap">
                        {new Date(activeEmail.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        ({new Date(activeEmail.date).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                      </span>
                    </div>
                  </div>
                );
              })()}

              {/* Email Content Body */}
              <div className="pt-2 text-[14px] leading-relaxed text-gray-800 font-sans min-h-[160px] overflow-hidden break-words">
                  {activeEmail.body || activeEmail.html ? (
                    <EmailBodyRenderer content={activeEmail.body || ''} html={activeEmail.html} />
                  ) : (
                    <div className="space-y-3">
                      <EmailBodyRenderer content={activeEmail.snippet} className="text-gray-600" />
                      {isLoadingBody && (
                        <div className="flex items-center gap-2 text-xs text-gray-400 pt-2">
                          <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF751F]" />
                          <span>Loading full message body...</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
          ) : filteredEmails.length === 0 && !isLoadingSent ? (
            <div className="p-16 text-center text-sm text-gray-500">No sent messages found.</div>
          ) : (
            /* Sent Emails Row Table Flat */
            <div className="divide-y divide-[#E5E5E7]">
              {isLoadingSent ? (
                <div className="p-16 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-[#FF751F]" />
                  Loading sent mail...
                </div>
              ) : (
                filteredEmails.map((email, idx) => (
                  <div
                    key={`${email.id}-${idx}`}
                    onClick={() => handleSelectEmail(email)}
                    className="flex items-center gap-4 px-5 sm:px-6 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors bg-white font-normal"
                  >
                    <div className="text-gray-300 hover:text-amber-400 transition-colors shrink-0">
                      <Star className="w-4 h-4" />
                    </div>

                    <div className="w-44 sm:w-52 truncate text-[13px] text-gray-900 shrink-0 font-medium">
                      To: {email.sender.replace(/<.*>/, '').trim() || email.sender}
                    </div>

                    <div className="flex-1 min-w-0 flex items-center gap-2 text-[13px]">
                      <span className="text-gray-900 font-semibold truncate">{email.subject}</span>
                      <span className="text-gray-500 font-normal truncate hidden sm:inline">- {email.snippet}</span>
                    </div>

                    <div className="text-[12px] text-gray-500 whitespace-nowrap shrink-0 font-medium">
                      {new Date(email.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
                    </div>
                  </div>
                ))
              )}

              {/* Infinite scroll sentinel and subtle loading indicator */}
              {(isLoadingMore || nextPageToken) && (
                <div ref={observerTarget} className="py-6 flex items-center justify-center text-xs text-gray-400">
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2">
                      <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF751F]" />
                      <span>Loading more messages...</span>
                    </div>
                  ) : (
                    <span>Scroll for more</span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
