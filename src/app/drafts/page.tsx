'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import Sidebar from '@/components/Sidebar';
import ComposeModal from '@/components/ComposeModal';
import EmailBodyRenderer from '@/components/EmailBodyRenderer';
import {
  Search,
  RefreshCw,
  ArrowLeft,
  FileText,
  Trash2,
  PenSquare,
  Send,
  Calendar
} from 'lucide-react';

interface DraftEmail {
  id: string;
  messageId: string;
  threadId: string;
  subject: string;
  to: string;
  date: string;
  snippet: string;
  body: string;
  html?: string;
}

export default function DraftsPage() {
  const [drafts, setDrafts] = useState<DraftEmail[]>([]);
  const [activeDraft, setActiveDraft] = useState<DraftEmail | null>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [isLoadingDrafts, setIsLoadingDrafts] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [nextPageToken, setNextPageToken] = useState<string | undefined>(undefined);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // Compose Modal State for editing/sending draft
  const [isComposeOpen, setIsComposeOpen] = useState(false);
  const [composeInitialTo, setComposeInitialTo] = useState('');
  const [composeInitialSubject, setComposeInitialSubject] = useState('');
  const [composeInitialBody, setComposeInitialBody] = useState('');
  const [composeDraftId, setComposeDraftId] = useState<string | undefined>(undefined);
  const [composeThreadId, setComposeThreadId] = useState<string | undefined>(undefined);

  const observerTarget = useRef<HTMLDivElement | null>(null);

  const [isLoadingBody, setIsLoadingBody] = useState(false);

  const fetchDraftsPage = async (token?: string, isAppend = false) => {
    if (isAppend) {
      setIsLoadingMore(true);
    } else {
      setIsLoadingDrafts(true);
    }

    try {
      let url = '/api/gmail/drafts?maxResults=15';
      if (token) {
        url += `&pageToken=${encodeURIComponent(token)}`;
      }

      const res = await fetch(url);
      const data = await res.json();

      if (data.success) {
        setDrafts(prev => (isAppend ? [...prev, ...(data.drafts || [])] : data.drafts || []));
        setNextPageToken(data.nextPageToken);
      } else {
        setStatusMessage(data.error || 'Failed to fetch drafts.');
      }
    } catch (err: any) {
      console.error('Failed to load Gmail drafts:', err);
      setStatusMessage('Error loading drafts from Gmail.');
    } finally {
      setIsLoadingDrafts(false);
      setIsLoadingMore(false);
    }
  };

  const handleSelectDraft = async (draft: DraftEmail) => {
    setActiveDraft(draft);
    if (!draft.body) {
      setIsLoadingBody(true);
      try {
        const res = await fetch(`/api/gmail/message?id=${encodeURIComponent(draft.messageId || draft.id)}`);
        const data = await res.json();
        if (data.success && (data.body || data.html)) {
          setActiveDraft(prev => (prev && prev.id === draft.id ? { ...prev, body: data.body, html: data.html } : prev));
          setDrafts(prev =>
            prev.map(d => (d.id === draft.id ? { ...d, body: data.body, html: data.html } : d))
          );
        }
      } catch (err) {
        console.warn('Failed to load draft body:', err);
      } finally {
        setIsLoadingBody(false);
      }
    }
  };

  useEffect(() => {
    fetchDraftsPage(undefined, false);
  }, []);

  const loadMore = useCallback(() => {
    if (!isLoadingDrafts && !isLoadingMore && nextPageToken) {
      fetchDraftsPage(nextPageToken, true);
    }
  }, [isLoadingDrafts, isLoadingMore, nextPageToken]);

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

  const handleDeleteDraft = async (draftId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    // Immediate discard without confirmation popup
    setDrafts(prev => prev.filter(d => d.id !== draftId));
    if (activeDraft?.id === draftId) setActiveDraft(null);
    setDeletingId(draftId);
    setStatusMessage('Draft discarded.');

    try {
      await fetch(`/api/gmail/drafts?id=${encodeURIComponent(draftId)}`, { method: 'DELETE' });
      setTimeout(() => setStatusMessage(null), 2500);
    } catch (err) {
      console.error('Delete draft error:', err);
    } finally {
      setDeletingId(null);
    }
  };

  const openComposeFromDraft = (draft: DraftEmail) => {
    setComposeInitialTo(draft.to);
    setComposeInitialSubject(draft.subject);
    setComposeInitialBody(draft.body || draft.snippet);
    setComposeDraftId(draft.id);
    setComposeThreadId(draft.threadId);
    setIsComposeOpen(true);
  };

  const openNewCompose = () => {
    setComposeInitialTo('');
    setComposeInitialSubject('');
    setComposeInitialBody('');
    setComposeDraftId(undefined);
    setComposeThreadId(undefined);
    setIsComposeOpen(true);
  };

  const filteredDrafts = drafts.filter(
    d =>
      d.subject.toLowerCase().includes(searchFilter.toLowerCase()) ||
      d.to.toLowerCase().includes(searchFilter.toLowerCase()) ||
      d.snippet.toLowerCase().includes(searchFilter.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-gray-900">
      <Sidebar onCompose={openNewCompose} />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        {/* Main Content Area */}
        <div className="flex-1 overflow-y-auto bg-white">
          {activeDraft ? (
            /* Detailed Draft Preview - Clean Minimalist Header */
            <div className="w-full px-4 sm:px-8 py-4 sm:py-6 space-y-5">
              {/* Top Action Toolbar with Back Button & Subject */}
              <div className="flex items-center justify-between gap-3 pb-1">
                <div className="flex items-center gap-3 min-w-0">
                  <button
                    onClick={() => setActiveDraft(null)}
                    className="p-2 -ml-2 rounded-full hover:bg-gray-100 text-gray-700 transition-colors cursor-pointer shrink-0"
                    title="Back to Drafts"
                  >
                    <ArrowLeft className="w-5 h-5" />
                  </button>

                  <h1 className="text-xl sm:text-2xl font-normal text-gray-900 tracking-tight leading-snug truncate">
                    {activeDraft.subject || '(No Subject)'}
                  </h1>
                </div>

                <div className="flex items-center gap-2 shrink-0">
                  <span className="text-xs text-red-500 bg-red-50 px-2.5 py-0.5 rounded-full font-semibold border border-red-200/60">
                    Draft
                  </span>
                  <button
                    onClick={(e) => handleDeleteDraft(activeDraft.id, e)}
                    disabled={deletingId === activeDraft.id}
                    className="p-1.5 rounded-full hover:bg-red-50 text-gray-500 hover:text-red-600 transition-colors cursor-pointer"
                    title="Discard Draft"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Recipient / Saved info Row */}
              <div className="flex items-start justify-between gap-4 pt-2">
                <div className="flex items-start gap-3.5 min-w-0">
                  {/* Avatar */}
                  <div className="w-10 h-10 rounded-full bg-stone-700 text-white flex items-center justify-center font-medium text-base shrink-0 select-none shadow-2xs">
                    {(activeDraft.to || 'D').charAt(0).toUpperCase()}
                  </div>

                  {/* Info */}
                  <div className="min-w-0 text-[13px] leading-tight space-y-1">
                    <div className="font-bold text-gray-900">
                      To: {activeDraft.to || '<No recipient specified>'}
                    </div>
                    <div className="text-gray-500 text-xs font-normal">
                      Draft saved
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3 shrink-0 pt-0.5">
                  <span className="text-xs text-gray-500 font-normal whitespace-nowrap">
                    {new Date(activeDraft.date).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}{' '}
                    ({new Date(activeDraft.date).toLocaleDateString([], { month: 'short', day: 'numeric' })})
                  </span>
                </div>
              </div>

              {/* Email Content Body */}
              <div className="pt-2 text-[14px] leading-relaxed text-gray-800 font-sans min-h-[160px] overflow-hidden break-words">
                    {activeDraft.body || activeDraft.html ? (
                      <EmailBodyRenderer content={activeDraft.body || ''} html={activeDraft.html} />
                    ) : (
                      <div className="space-y-3">
                        <EmailBodyRenderer content={activeDraft.snippet || '<Draft is empty>'} className="text-gray-600" />
                        {isLoadingBody && (
                          <div className="flex items-center gap-2 text-xs text-gray-400 pt-2">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin text-[#FF751F]" />
                            <span>Loading full draft content...</span>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                </div>
            ) : filteredDrafts.length === 0 && !isLoadingDrafts ? (
              <div className="p-16 text-center text-sm text-gray-500">No draft messages found.</div>
            ) : (
              /* Draft Rows Table Flat */
              <div className="divide-y divide-[#E5E5E7]">
                {isLoadingDrafts ? (
                  <div className="p-16 text-center text-xs text-gray-500 flex items-center justify-center gap-2">
                    <RefreshCw className="w-4 h-4 animate-spin text-[#FF751F]" />
                    Loading drafts...
                  </div>
                ) : (
                  filteredDrafts.map(draft => (
                    <div
                      key={draft.id}
                      onClick={() => handleSelectDraft(draft)}
                      className="flex items-center gap-4 px-5 sm:px-6 py-3.5 cursor-pointer hover:bg-gray-50 transition-colors bg-white font-normal group"
                    >
                      <div className="text-red-500 shrink-0 font-semibold text-xs">
                        Draft
                      </div>

                      <div className="w-44 sm:w-52 truncate text-[13px] text-gray-900 shrink-0 font-medium">
                        {draft.to ? `To: ${draft.to}` : '<No Recipient>'}
                      </div>

                      <div className="flex-1 min-w-0 flex items-center gap-2 text-[13px]">
                        <span className="text-gray-900 font-semibold truncate">{draft.subject || '(No Subject)'}</span>
                        <span className="text-gray-500 font-normal truncate hidden sm:inline">- {draft.snippet}</span>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            openComposeFromDraft(draft);
                          }}
                          className="p-1.5 rounded-lg hover:bg-gray-200/70 text-gray-500 hover:text-[#FF751F] transition-colors"
                          title="Edit Draft"
                        >
                          <PenSquare className="w-4 h-4" />
                        </button>
                        <button
                          onClick={(e) => handleDeleteDraft(draft.id, e)}
                          disabled={deletingId === draft.id}
                          className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors"
                          title="Discard Draft"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>

                      <div className="text-[12px] text-gray-500 whitespace-nowrap shrink-0 font-medium">
                        {new Date(draft.date).toLocaleDateString([], { month: 'short', day: 'numeric' })}
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
                        <span>Loading more drafts...</span>
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
          draftId={composeDraftId}
          threadId={composeThreadId}
          onEmailSent={() => {
            fetchDraftsPage(undefined);
            setActiveDraft(null);
          }}
          onDraftSaved={() => {
            fetchDraftsPage(undefined);
          }}
        />
      </main>
    </div>
  );
}
