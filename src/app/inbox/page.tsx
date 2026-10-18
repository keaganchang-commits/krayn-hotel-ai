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
  Reply,
  PenSquare
} from 'lucide-react';

interface InboxEmail {
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

export default function InboxPage() {
  const router = useRouter();
  const [inboxEmails, setInboxEmails] = useState<InboxEmail[]>([]);
  const [activeEmail, setActiveEmail] = useState<InboxEmail | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoadingInbox, setIsLoadingInbox] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [isAutoReplying, setIsAutoReplying] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [totalMessagesCount, setTotalMessagesCount] = useState(0);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);

  // Compose Modal State
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeInitialTo, setComposeInitialTo] = useState('');
  const [composeInitialSubject, setComposeInitialSubject] = useState('');
  const [composeInitialBody, setComposeInitialBody] = useState('');
  const [composeThreadId, setComposeThreadId] = useState<string | undefined>(undefined);
  const [composeInReplyToMsgId, setComposeInReplyToMsgId] = useState<string | undefined>(undefined);

  const observerTarget = useRef<HTMLDivElement | null>(null);

  const [isLoadingBody, setIsLoadingBody] = useState(false);

  const fetchInboxPage = async (token?: string, isAppend = false) => {
    if (isAppend) {
      setIsLoadingMore(true);
    } else {
      setIsLoadingInbox(true);
    }

    try {
      let url = '/api/gmail/inbox?maxResults=15&q=in:inbox';
      if (token) {
        url += `&pageToken=${encodeURIComponent(token)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        setInboxEmails(prev => {
          const incoming: InboxEmail[] = data.emails || [];
          if (!isAppend) return incoming;
          const existingIds = new Set(prev.map(e => e.id));
          const newEmails = incoming.filter(e => !existingIds.has(e.id));
          return [...prev, ...newEmails];
        });
        setNextPageToken(data.nextPageToken);
        if (data.totalMessages) setTotalMessagesCount(data.totalMessages);
      }
    } catch (err) {
      console.error('Failed to load Gmail inbox page:', err);
    } finally {
      setIsLoadingInbox(false);
      setIsLoadingMore(false);
    }
  };

  const handleSelectEmail = async (email: InboxEmail) => {
    setActiveEmail(email);
    if (!email.body) {
      setIsLoadingBody(true);
      try {
        const res = await fetch(`/api/gmail/message?id=${encodeURIComponent(email.id)}`);
        const data = await res.json();
        if (data.success && (data.body || data.html)) {
          setActiveEmail(prev => (prev && prev.id === email.id ? { ...prev, body: data.body, html: data.html } : prev));
          setInboxEmails(prev =>
            prev.map(e => (e.id === email.id ? { ...e, body: data.body, html: data.html } : e))
          );
        }
      } catch (err) {
        console.warn('Failed to load full email body:', err);
      } finally {
        setIsLoadingBody(false);
      }
    }
  };

  const fetchAutoReplyStatus = async () => {
    try {
      const res = await fetch('/api/gmail/autoreply');
      const data = await res.json();
      if (data.success) {
        setAutoReplyEnabled(data.enabled);
      }
    } catch (e) {}
  };

  useEffect(() => {
    fetchInboxPage(undefined, false);
    fetchAutoReplyStatus();
  }, []);

  const loadMore = useCallback(() => {
    if (!isLoadingInbox && !isLoadingMore && nextPageToken) {
      fetchInboxPage(nextPageToken, true);
    }
  }, [isLoadingInbox, isLoadingMore, nextPageToken]);

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

  const handleToggleAutoReply = async () => {
    const newState = !autoReplyEnabled;
    try {
      const res = await fetch('/api/gmail/autoreply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: newState }),
      });
      const data = await res.json();
      if (data.success) {
        setAutoReplyEnabled(data.enabled);
        setStatusMessage(data.message);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      console.error('Failed to toggle auto reply:', err);
    }
  };

  const handleTriggerAutoReply = async () => {
    setIsAutoReplying(true);
    try {
      const res = await fetch('/api/gmail/autoreply', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ maxResults: 10 }),
      });
      const data = await res.json();

      if (data.success) {
        setStatusMessage(data.message);
        await fetchInboxPage(undefined, false);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err) {
      console.error('Auto reply trigger failed:', err);
    } finally {
      setIsAutoReplying(false);
    }
  };

  const openNewCompose = () => {
    setComposeInitialTo('');
    setComposeInitialSubject('');
    setComposeInitialBody('');
    setComposeThreadId(undefined);
    setComposeInReplyToMsgId(undefined);
    setIsComposeOpen(true);
  };

  const openReplyCompose = (email: InboxEmail) => {
    const replySubject = email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`;
    setComposeInitialTo(email.sender);
    setComposeInitialSubject(replySubject);
    setComposeInitialBody(`\n\n--- On ${new Date(email.date).toLocaleString()}, ${email.sender} wrote:\n> ${email.snippet}`);
    setComposeThreadId(email.threadId);
    setComposeInReplyToMsgId(email.id);
    setIsComposeOpen(true);
  };

  const filteredEmails = inboxEmails.filter(
    e =>
      e.subject.toLowerCase().includes(searchFilter.toLowerCase()) ||
      e.sender.toLowerCase().includes(searchFilter.toLowerCase()) ||
      e.snippet.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-gray-900">
      <Sidebar syncedEmailsCount={totalMessagesCount} onCompose={openNewCompose} />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeEmail ? (
            /* Gmail Detailed Email View - Exact Minimalist Gmail Header */
            <div className="w-full px-4 sm:px-8 py-4 sm:py-6 space-y-5">
              {/* Top Action Toolbar with Back Button & Subject */}
              <div className="flex items-center gap-3 pb-1">
                <button
                  onClick={() => setActiveEmail(null)}
                  className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer shrink-0"
                  title="Back to Inbox"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>

                <h1 className="text-xl sm:text-2xl font-normal text-gray-900 tracking-tight leading-snug truncate">
                  {activeEmail.subject || '(No Subject)'}
                </h1>
              </div>

              {/* Sender Details Row - Open, unboxed layout matching Gmail */}
              {(() => {
                const rawSender = activeEmail.sender || '';
                const emailMatch = rawSender.match(/<([^>]+)>/);
                const emailAddress = emailMatch ? emailMatch[1] : (rawSender.includes('@') ? rawSender : '');
                const displayName = rawSender.replace(/<[^>]+>/, '').trim() || emailAddress || 'Unknown';
                const initial = displayName.charAt(0).toUpperCase() || 'U';

                return (
                  <div className="flex items-start justify-between gap-4 pt-2">
                    <div className="flex items-start gap-3.5 min-w-0">
                      {/* Avatar */}
                      <div className="w-10 h-10 rounded-full bg-stone-700 text-white flex items-center justify-center font-medium text-base shrink-0 select-none shadow-2xs">
                        {initial}
                      </div>

                      {/* Sender Info */}
                      <div className="min-w-0 text-[13px] leading-tight space-y-1">
                        <div className="flex flex-wrap items-baseline gap-1.5">
                          <span className="font-bold text-gray-900">{displayName}</span>
                          {emailAddress && emailAddress !== displayName && (
                            <span className="text-gray-500 font-normal">&lt;{emailAddress}&gt;</span>
                          )}
                        </div>
                        <div className="text-gray-500 text-xs flex items-center gap-1 font-normal">
                          <span>to me</span>
                          <span className="text-[10px] text-gray-400">▾</span>
                        </div>
                      </div>
                    </div>

                    {/* Timestamp & Top Reply Action Pill */}
                    <div className="flex items-center gap-3 shrink-0 pt-0.5">
                      <span className="text-xs text-gray-500 font-normal whitespace-nowrap">
                        {new Date(activeEmail.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                        ({new Date(activeEmail.date).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                      </span>
                      <button
                        onClick={() => openReplyCompose(activeEmail)}
                        className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded-full border border-gray-300 hover:bg-gray-50 hover:border-gray-400 text-gray-700 text-xs font-medium transition-all cursor-pointer shadow-2xs"
                        title="Reply"
                      >
                        <Reply className="w-3.5 h-3.5" />
                        <span>Reply</span>
                      </button>
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
              ) : filteredEmails.length === 0 && !isLoadingInbox ? (
              <div className="p-16 text-center text-sm text-gray-500">No messages found.</div>
            ) : (
              /* Gmail Row Table View - Flat Edge-to-Edge List */
              <div className="divide-y divide-[#E5E5E7]">
                {isLoadingInbox ? (
                  <div className="p-16 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[#FF751F]" />
                    Loading Gmail inbox...
                  </div>
                ) : (
                  filteredEmails.map((email, idx) => (
                    <div
                      key={`${email.id}-${idx}`}
                      onClick={() => handleSelectEmail(email)}
                      className={`flex items-center gap-4 px-5 sm:px-6 py-3.5 cursor-pointer hover:bg-white transition-colors bg-white ${
                        email.unread ? 'font-bold' : 'font-normal'
                      }`}
                    >
                      <div className="text-gray-300 hover:text-amber-400 transition-colors shrink-0">
                        <Star className="w-4 h-4" />
                      </div>

                      <div className="w-44 sm:w-52 truncate text-[13px] text-gray-900 shrink-0 font-medium">
                        {email.sender.replace(/<.*>/, '').trim() || email.sender}
                      </div>

                      <div className="flex-1 min-w-0 flex items-center gap-2 text-[13px]">
                        <span className="text-gray-900 font-semibold truncate">{email.subject}</span>
                        <span className="text-gray-500 font-normal truncate hidden sm:inline">- {email.snippet}</span>
                      </div>

                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          openReplyCompose(email);
                        }}
                        className="p-1.5 rounded-lg hover:bg-gray-200/70 text-gray-400 hover:text-[#FF751F] transition-colors shrink-0"
                        title="Quick Reply"
                      >
                        <Reply className="w-4 h-4" />
                      </button>

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

        {/* Floating Bottom-Right Compose Pop-out */}
        <ComposeModal
          isOpen={isComposeOpen}
          onClose={() => setIsComposeOpen(false)}
          initialTo={composeInitialTo}
          initialSubject={composeInitialSubject}
          initialBody={composeInitialBody}
          threadId={composeThreadId}
          inReplyToMsgId={composeInReplyToMsgId}
          onEmailSent={() => fetchInboxPage(undefined, false)}
        />
      </main>
    </div>
  );
}
