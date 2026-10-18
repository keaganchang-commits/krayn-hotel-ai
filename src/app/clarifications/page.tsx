'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import { RefreshCw, Paperclip, X } from 'lucide-react';

import { SEED_ONBOARDING_QUESTIONS, normalizeQuestionText, cleanOptionLabel, getPrePreparedFollowUps } from '@/lib/clarify/seedQuestions';


interface ClarificationItem {
  id: string;
  seedId?: string;
  question: string;
  options: string[];
  title: string;
  source: string;
  timestamp: string;
  inputType?: 'options' | 'text' | 'file' | 'boolean';
  placeholder?: string;
  emailId?: string;
  threadId?: string;
  inReplyToMsgId?: string;
  sender?: string;
  originalBody?: string;
  isOnboarding?: boolean;
  answeredOption?: string;
  allowMultiple?: boolean;
  followUpsByOption?: Record<string, any>;
  subQuestions?: ClarificationItem[];
  isGeneratingFollowUps?: boolean;
  waitingEmails?: Array<{
    emailId?: string;
    threadId?: string;
    inReplyToMsgId?: string;
    sender?: string;
    originalBody?: string;
  }>;
}

// Instant synchronous fallback so the page never blocks on a blank screen or loading spinner
const INITIAL_SYNCHRONOUS_QUESTIONS: ClarificationItem[] = SEED_ONBOARDING_QUESTIONS.map(q => ({
  id: q.id,
  seedId: q.id,
  question: q.question,
  options: q.options,
  title: q.title,
  source: 'onboarding',
  timestamp: new Date().toISOString(),
  inputType: q.inputType || 'options',
  placeholder: q.placeholder,
  isOnboarding: true,
}));

export default function ClarificationsPage() {
  const [clarifications, setClarifications] = useState<ClarificationItem[]>([]);
  const [isHydrated, setIsHydrated] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);
  const [answeredOnboardingIds, setAnsweredOnboardingIds] = useState<string[]>([]);
  const [customInputs, setCustomInputs] = useState<Record<string, string>>({});
  const [expandedCustomIds, setExpandedCustomIds] = useState<Record<string, boolean>>({});
  const [isScanningGaps, setIsScanningGaps] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedMultiOptions, setSelectedMultiOptions] = useState<Record<string, string[]>>({});
  const [uploadingQuestionId, setUploadingQuestionId] = useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const activeUploadItemRef = React.useRef<ClarificationItem | null>(null);

  const triggerUploadForQuestion = (item: ClarificationItem) => {
    activeUploadItemRef.current = item;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files ? Array.from(e.target.files) : [];
    const item = activeUploadItemRef.current;
    if (files.length === 0 || !item) return;

    setUploadingQuestionId(item.id);
    setStatusMessage(`Uploading & processing ${files.length} ${files.length === 1 ? 'file' : 'files'}...`);

    const uploadedNames: string[] = [];

    try {
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        setStatusMessage(`Uploading ${file.name} (${i + 1}/${files.length})...`);
        const formData = new FormData();
        formData.append('file', file);
        formData.append('question', item.question);

        const res = await fetch('/api/assets', {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) {
          const errData = await res.json().catch(() => ({}));
          throw new Error(errData.error || `Upload failed with status ${res.status}`);
        }

        const data = await res.json();
        if (data.success && data.asset) {
          uploadedNames.push(data.asset.name);
        }
      }

      if (uploadedNames.length > 0) {
        setStatusMessage(`Uploaded ${uploadedNames.length} document${uploadedNames.length === 1 ? '' : 's'}. Extracting facts in background...`);
        const resolutionText = `Uploaded documents: ${uploadedNames.join(', ')}`;
        await handleResolveOption(item, resolutionText);
        // Refresh clarifications after short moment to pick up follow-up sharing question
        setTimeout(() => {
          fetchPreGeneratedQuestions();
        }, 1200);
      } else {
        alert('Failed to upload selected assets.');
      }
    } catch (err: any) {
      console.error('Failed to upload files for question:', err);
      alert('Upload failed: ' + (err.message || 'Network error'));
    } finally {
      setUploadingQuestionId(null);
      activeUploadItemRef.current = null;
      setTimeout(() => setStatusMessage(null), 4000);
    }
  };

  const [isScanningRecentKnowledge, setIsScanningRecentKnowledge] = useState(false);
  const [isRecentOrangeTimeout, setIsRecentOrangeTimeout] = useState(false);

  const handleScanGaps = async () => {
    if (isScanningGaps || isScanningRecentKnowledge) return;
    setIsScanningGaps(true);
    setStatusMessage('Checking for fresh questions...');

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);

    try {
      const res = await fetch('/api/clarify/scan', {
        method: 'POST',
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      const data = await res.json();
      if (data && data.success) {
        setStatusMessage(data.message || 'Updated questions.');
      }
      await fetchPreGeneratedQuestions();
    } catch (err: any) {
      console.warn('Scan notice / error:', err);
      // Even if network or AI timed out, still fetch whatever pre-generated questions we have
      await fetchPreGeneratedQuestions();
    } finally {
      clearTimeout(timeoutId);
      setIsScanningGaps(false);
      setTimeout(() => setStatusMessage(null), 3000);
    }
  };

  const handleSecretRecentKnowledgeScan = async () => {
    if (isScanningGaps || isScanningRecentKnowledge) return;
    setIsScanningRecentKnowledge(true);

    try {
      // Clear local cache snapshot so new highest-priority questions load fresh at the top
      try {
        localStorage.removeItem('cached_clarifications_list');
      } catch (e) {}

      const res = await fetch('/api/clarify/scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: 'recent_15m' }),
      });
      const data = await res.json();

      if (data && data.noRecentKnowledge) {
        // No new knowledge in past 15 mins -> Turn text orange for a few seconds
        setIsRecentOrangeTimeout(true);
        setTimeout(() => setIsRecentOrangeTimeout(false), 3500);
      } else {
        // Generated questions from recent knowledge -> Fetch and place at top
        await fetchPreGeneratedQuestions();
      }
    } catch (err) {
      console.warn('Recent knowledge scan notice / error:', err);
    } finally {
      setIsScanningRecentKnowledge(false);
    }
  };

  // 1. Instant Cache Hydration: Read answered onboarding IDs and cached questions smoothly on mount
  useEffect(() => {
    try {
      const savedAnswered = localStorage.getItem('answered_onboarding_ids');
      const savedAnsweredTexts = localStorage.getItem('answered_question_norms');
      let answered: string[] = savedAnswered ? JSON.parse(savedAnswered) : [];
      let answeredTexts: string[] = savedAnsweredTexts ? JSON.parse(savedAnsweredTexts) : [];

      setAnsweredOnboardingIds(answered);

      const isQuestionAnswered = (q: ClarificationItem) => {
        if (answered.includes(q.id) || (q.seedId && answered.includes(q.seedId))) return true;
        const norm = normalizeQuestionText(q.question);
        if (norm && answeredTexts.includes(norm)) return true;
        return false;
      };

      const cached = localStorage.getItem('cached_clarifications_list');
      if (cached) {
        const parsed: ClarificationItem[] = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const filtered = parsed.filter(q => !isQuestionAnswered(q));
          setClarifications(filtered);
        } else {
          const filteredInitial = INITIAL_SYNCHRONOUS_QUESTIONS.filter(q => !isQuestionAnswered(q));
          setClarifications(filteredInitial);
        }
      } else {
        const filteredInitial = INITIAL_SYNCHRONOUS_QUESTIONS.filter(q => !isQuestionAnswered(q));
        setClarifications(filteredInitial);
      }
    } catch (e) {
      setClarifications(INITIAL_SYNCHRONOUS_QUESTIONS);
    } finally {
      setIsHydrated(true);
    }

    // Fetch initial pre-generated questions once on page load without auto-polling
    fetchPreGeneratedQuestions();
  }, []);

  // 2. Background Instant Fetch: The server has already pre-generated & pre-ranked everything in the worker
  const fetchPreGeneratedQuestions = async () => {
    try {
      const res = await fetch('/api/clarify');
      const data = await res.json();

      if (data.success && Array.isArray(data.questions)) {
        const savedAnswered = localStorage.getItem('answered_onboarding_ids');
        const savedAnsweredTexts = localStorage.getItem('answered_question_norms');
        const answered: string[] = savedAnswered ? JSON.parse(savedAnswered) : [];
        const answeredTexts: string[] = savedAnsweredTexts ? JSON.parse(savedAnsweredTexts) : [];

        const activeQuestions: ClarificationItem[] = data.questions.filter(
          (q: ClarificationItem) => {
            if (answered.includes(q.id) || (q.seedId && answered.includes(q.seedId))) return false;
            const norm = normalizeQuestionText(q.question);
            if (norm && answeredTexts.includes(norm)) return false;
            return true;
          }
        );

        setClarifications(activeQuestions);
        try {
          localStorage.setItem('cached_clarifications_list', JSON.stringify(activeQuestions));
        } catch (e) {}
      }
    } catch (err) {
      console.warn('Silent background clarify sync:', err);
    }
  };

  const handleResolveOption = async (item: ClarificationItem, selectedOption: string) => {
    if (!selectedOption.trim()) return;
    setResolvingId(item.id);

    // 1. Instantly check if this question has pre-prepared follow-ups for this selection
    // Follow-ups are only allowed for fixed selections (options / boolean), not file uploads or open text
    const isFixedSelection = item.inputType === 'options' || item.inputType === 'boolean' || !item.inputType;
    const prePreparedSpecs = isFixedSelection
      ? getPrePreparedFollowUps(item.question, selectedOption, item.title, item.followUpsByOption)
      : [];

    const immediateFollowUps: ClarificationItem[] = prePreparedSpecs.map((spec, idx) => ({
      id: `fu-${Date.now()}-${idx}-${Math.random().toString(36).substring(2, 6)}`,
      question: spec.question,
      options: spec.options,
      title: spec.topic || item.title,
      source: 'clarification',
      timestamp: new Date().toISOString(),
      isOnboarding: false,
      inputType: spec.inputType || 'options',
      placeholder: spec.placeholder,
      allowMultiple: spec.allowMultiple ?? false,
    }));

    // If follow-ups are deemed necessary, attach them directly in-place; otherwise clear question immediately!
    const updateListInstantly = (list: ClarificationItem[]): ClarificationItem[] => {
      return list
        .map(c => {
          if (c.id === item.id) {
            if (immediateFollowUps.length > 0) {
              return {
                ...c,
                answeredOption: selectedOption.trim(),
                isGeneratingFollowUps: false,
                subQuestions: immediateFollowUps,
              };
            }
            // No follow-ups deemed necessary: mark answered (will be filtered out)
            return {
              ...c,
              answeredOption: selectedOption.trim(),
              isGeneratingFollowUps: false,
              subQuestions: [],
            };
          }
          if (c.subQuestions && c.subQuestions.length > 0) {
            return {
              ...c,
              subQuestions: updateListInstantly(c.subQuestions),
            };
          }
          return c;
        })
        .filter(c => {
          // Immediately prune answered items that have no active unanswered sub-questions
          if (c.answeredOption) {
            if (c.subQuestions && c.subQuestions.length > 0) {
              return c.subQuestions.some(sub => !sub.answeredOption);
            }
            return false;
          }
          return true;
        });
    };

    setClarifications(prev => {
      const nextList = updateListInstantly(prev);
      try {
        localStorage.setItem('cached_clarifications_list', JSON.stringify(nextList));
      } catch (e) {}
      return nextList;
    });

    // Persist answered ID and normalized question text so it won't duplicate on page reloads
    const targetId = item.seedId || item.id;
    const updatedAnswered = [...answeredOnboardingIds, targetId, item.id];
    setAnsweredOnboardingIds(updatedAnswered);

    try {
      localStorage.setItem('answered_onboarding_ids', JSON.stringify(updatedAnswered));
      const savedTexts = localStorage.getItem('answered_question_norms');
      const textList: string[] = savedTexts ? JSON.parse(savedTexts) : [];
      const normQ = normalizeQuestionText(item.question);
      if (normQ && !textList.includes(normQ)) {
        textList.push(normQ);
        localStorage.setItem('answered_question_norms', JSON.stringify(textList));
      }
    } catch (e) {}

    // Send async resolution in the background to persist knowledge
    try {
      await fetch('/api/clarify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: item.id,
          seedId: item.seedId,
          question: item.question,
          selectedOption: selectedOption.trim(),
          topic: item.title,
          emailId: item.emailId,
          threadId: item.threadId,
          inReplyToMsgId: item.inReplyToMsgId,
          sender: item.sender,
          originalBody: item.originalBody,
          waitingEmails: item.waitingEmails,
        }),
      });

      // Delete resolved item from store
      if (!item.isOnboarding) {
        await fetch(`/api/knowledge?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' });
      }

    } catch (err) {
      console.error('Resolution error:', err);
      // If error, stop the spinner
      setClarifications(prev =>
        prev.map(c => (c.id === item.id ? { ...c, isGeneratingFollowUps: false } : c))
      );
    } finally {
      setResolvingId(null);
    }
  };

  // Dismiss a question permanently if it's bad, irrelevant, or not needed
  const handleDismissQuestion = async (item: ClarificationItem) => {
    // 1. Immediately remove from local state
    setClarifications(prev => {
      const nextList = prev.filter(c => c.id !== item.id);
      try {
        localStorage.setItem('cached_clarifications_list', JSON.stringify(nextList));
      } catch (e) {}
      return nextList;
    });

    // 2. Mark as dismissed in localStorage so it never re-appears
    const targetId = item.seedId || item.id;
    const updatedAnswered = [...answeredOnboardingIds, targetId, item.id];
    setAnsweredOnboardingIds(updatedAnswered);

    try {
      localStorage.setItem('answered_onboarding_ids', JSON.stringify(updatedAnswered));
      const savedTexts = localStorage.getItem('answered_question_norms');
      const textList: string[] = savedTexts ? JSON.parse(savedTexts) : [];
      const normQ = normalizeQuestionText(item.question);
      if (normQ && !textList.includes(normQ)) {
        textList.push(normQ);
        localStorage.setItem('answered_question_norms', JSON.stringify(textList));
      }
    } catch (e) {}

    // 3. Delete from backend knowledge / vectorStore
    try {
      await fetch(`/api/clarify?id=${encodeURIComponent(item.id)}&question=${encodeURIComponent(item.question)}`, {
        method: 'DELETE',
      });
      if (!item.isOnboarding) {
        await fetch(`/api/knowledge?id=${encodeURIComponent(item.id)}`, { method: 'DELETE' }).catch(() => {});
      }
    } catch (err) {
      console.warn('Error dismissing question:', err);
    }
  };

  // Group questions by section/topic title, with Customer Inquiries ALWAYS guaranteed at the very top
  const groupedClarifications = React.useMemo(() => {
    const groups: Record<string, ClarificationItem[]> = {};
    for (const item of clarifications) {
      const isCustomer = !!(
        item.emailId ||
        item.sender ||
        item.threadId ||
        item.originalBody ||
        item.source === 'gmail' ||
        (item as any).sourceType === 'ai_chat' ||
        (item as any).originalCustomerQuery
      );
      const section = isCustomer ? 'Customer Inquiry' : (item.title || 'General');
      if (!groups[section]) groups[section] = [];
      groups[section].push(item);
    }

    // Sort entries so 'Customer Inquiry' is strictly first, followed by deterministic section order
    const entries = Object.entries(groups).sort(([a], [b]) => {
      if (a === 'Customer Inquiry') return -1;
      if (b === 'Customer Inquiry') return 1;
      return a.localeCompare(b);
    });

    return Object.fromEntries(entries);
  }, [clarifications]);

  const totalUnansweredCount = clarifications.length;

  return (
    <div className="flex h-screen bg-white overflow-hidden text-[#1D1D1F]">
      {/* Hidden file input for contextual document attachments (allows single or multiple uploads) */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept="application/pdf,image/*"
        multiple
        className="hidden"
      />

      <Sidebar />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        <div className="flex-1 overflow-y-auto w-full p-4 sm:p-6 lg:p-7 space-y-6">
          {!isHydrated ? (
            <div className="w-full py-16 flex flex-col items-center justify-center space-y-3 opacity-40">
              <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
              <p className="text-xs text-gray-400 font-medium">Loading questions...</p>
            </div>
          ) : totalUnansweredCount === 0 ? (
            <div className="w-full py-16 text-center text-sm text-gray-500 bg-white rounded-2xl border border-black/5 p-8 space-y-4">
              <p className="text-gray-700 font-medium">All caught up. No pending questions right now.</p>
              <button
                type="button"
                onClick={handleScanGaps}
                disabled={isScanningGaps}
                className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-black/10 bg-white hover:bg-gray-50 text-gray-800 transition-all cursor-pointer disabled:opacity-50 text-xs font-semibold"
                title={isScanningGaps ? 'Checking for new questions...' : 'Check for questions'}
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isScanningGaps ? 'animate-spin text-[#FF751F]' : ''}`} />
                <span>{isScanningGaps ? 'Checking...' : 'Check for Questions'}</span>
              </button>
            </div>
          ) : (
            <div className="w-full space-y-6">
              {Object.entries(groupedClarifications).map(([sectionTitle, items], sectionIndex) => (
                <div key={sectionTitle} className="w-full space-y-1">
                  {/* Category Section Header */}
                  <div className="flex items-center justify-between pb-0.5">
                    <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                      <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                        {sectionTitle}
                      </h3>
                      <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                        {items.length}
                      </span>
                    </div>

                    {/* Refresh Button on the Top Right of the First Section Header Row */}
                    {sectionIndex === 0 && (
                      <div
                        className="inline-flex items-center rounded-xl border border-black/10 bg-white text-gray-700 text-xs font-semibold overflow-hidden transition-colors"
                      >
                        {/* Icon Part: Rethink questions as it does now */}
                        <button
                          type="button"
                          onClick={handleScanGaps}
                          disabled={isScanningGaps || isScanningRecentKnowledge}
                          className="pl-2.5 pr-1 py-1.5 hover:bg-gray-50 hover:text-black transition-colors cursor-pointer disabled:opacity-50 flex items-center justify-center"
                          title="Refresh & rethink questions"
                        >
                          <RefreshCw
                            className={`w-3.5 h-3.5 ${
                              isScanningGaps ? 'animate-spin text-[#FF751F]' : ''
                            }`}
                          />
                        </button>

                        {/* Text Part: Secret trigger for knowledge learned in the past 15 mins */}
                        <button
                          type="button"
                          onClick={handleSecretRecentKnowledgeScan}
                          disabled={isScanningGaps || isScanningRecentKnowledge}
                          className="pr-2.5 pl-1 py-1.5 hover:bg-gray-50 transition-colors cursor-pointer disabled:opacity-50"
                          title="Refresh"
                        >
                          <span
                            className={`transition-colors duration-200 select-none ${
                              isScanningRecentKnowledge
                                ? 'text-[#FF751F] animate-pulse font-bold'
                                : isRecentOrangeTimeout
                                ? 'text-[#FF751F] font-bold'
                                : 'text-gray-700 hover:text-black'
                            }`}
                          >
                            {isScanningGaps ? 'Rethinking...' : isScanningRecentKnowledge ? 'Scanning...' : 'Refresh'}
                          </span>
                        </button>
                      </div>
                    )}
                  </div>

                  {/* Clean flat outer border container wrapping questions of this section */}
                  <div className="w-full rounded-2xl border border-gray-200/90 bg-white px-4 sm:px-6 divide-y divide-gray-100 shadow-none">
                    {items.map(item => (
                      <QuestionRow
                        key={item.id}
                        item={item}
                        resolvingId={resolvingId}
                        uploadingQuestionId={uploadingQuestionId}
                        expandedCustomIds={expandedCustomIds}
                        setExpandedCustomIds={setExpandedCustomIds}
                        customInputs={customInputs}
                        setCustomInputs={setCustomInputs}
                        selectedMultiOptions={selectedMultiOptions}
                        setSelectedMultiOptions={setSelectedMultiOptions}
                        onResolve={handleResolveOption}
                        onDismiss={handleDismissQuestion}
                        onAttachFile={triggerUploadForQuestion}
                      />
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

// Sub-component for individual question with Apple styling and immediate nested sub-questions
function QuestionRow({
  item,
  resolvingId,
  uploadingQuestionId,
  expandedCustomIds,
  setExpandedCustomIds,
  customInputs,
  setCustomInputs,
  selectedMultiOptions,
  setSelectedMultiOptions,
  onResolve,
  onDismiss,
  onAttachFile,
  depth = 0,
}: {
  item: ClarificationItem;
  resolvingId: string | null;
  uploadingQuestionId?: string | null;
  expandedCustomIds: Record<string, boolean>;
  setExpandedCustomIds: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
  customInputs: Record<string, string>;
  setCustomInputs: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  selectedMultiOptions?: Record<string, string[]>;
  setSelectedMultiOptions?: React.Dispatch<React.SetStateAction<Record<string, string[]>>>;
  onResolve: (item: ClarificationItem, val: string) => Promise<void>;
  onDismiss?: (item: ClarificationItem) => void;
  onAttachFile?: (item: ClarificationItem) => void;
  depth?: number;
}) {
  const isAnswered = !!item.answeredOption;
  const isGenerating = !!item.isGeneratingFollowUps;
  const hasSubQuestions = Array.isArray(item.subQuestions) && item.subQuestions.length > 0;
  const isMulti = item.allowMultiple !== false;
  const currentSelected = (selectedMultiOptions && selectedMultiOptions[item.id]) || [];

  const toggleOption = (option: string) => {
    if (!setSelectedMultiOptions) return;
    setSelectedMultiOptions(prev => {
      const existing = prev[item.id] || [];
      if (existing.includes(option)) {
        return { ...prev, [item.id]: existing.filter(o => o !== option) };
      } else {
        return { ...prev, [item.id]: [...existing, option] };
      }
    });
  };

  const handleConfirmMulti = async () => {
    if (currentSelected.length === 0) return;
    await onResolve(item, currentSelected.join(', '));
  };

  return (
    <div className={`w-full group/qrow relative ${depth === 0 ? 'py-4 first:pt-4 last:pb-4' : 'py-2.5'} space-y-2.5`}>
      {/* If answered, display compact Apple squircle pill with the selected answer */}
      {isAnswered ? (
        <div className="flex flex-wrap items-center gap-2.5 py-1">
          <span className="text-[14px] sm:text-[15px] font-medium text-gray-700 leading-snug">
            {item.question}
          </span>
          <span className="inline-flex items-center px-3 py-1 rounded-full bg-emerald-600 text-white text-xs font-semibold tracking-tight shadow-sm">
            Answer: {item.answeredOption}
          </span>
        </div>
      ) : (
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 flex flex-wrap items-center gap-2">
            <p className="text-[15px] sm:text-[16px] font-semibold text-gray-900 leading-snug">
              {item.question}
            </p>
            {isMulti && (
              <span className="text-[11px] font-medium text-gray-400 bg-gray-100/80 px-2 py-0.5 rounded-md shrink-0">
                Select all that apply
              </span>
            )}
          </div>

          {/* Top-Right Dismiss Button (X) */}
          {onDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(item)}
              disabled={resolvingId === item.id}
              className="w-7 h-7 -mr-1 -mt-0.5 rounded-full flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 active:bg-gray-200 transition-all cursor-pointer shrink-0 disabled:opacity-40"
              title="Dismiss question"
              aria-label="Dismiss question"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}

      {/* When awaiting response and generating follow-ups: sleek inline spinner */}
      {isGenerating && (
        <div className="flex items-center gap-2.5 py-2 px-3.5 rounded-xl bg-orange-50/60 border border-[#FF751F]/20 text-xs font-semibold text-[#FF751F]">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          <span>Generating tailored follow-up details...</span>
        </div>
      )}

      {/* Answer Interface (tailored by inputType: 'text', 'file', or 'options') */}
      {!isAnswered && (
        <>
          {/* 1. TEXT MANDATED INPUT (e.g. exact opening hours, addresses, hotline numbers) */}
          {item.inputType === 'text' ? (
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
              <input
                type="text"
                value={customInputs[item.id] || ''}
                onChange={e =>
                  setCustomInputs(prev => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }))
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (customInputs[item.id] || '').trim();
                    if (val) onResolve(item, val);
                  }
                }}
                placeholder={item.placeholder || 'Type exact details (e.g. Mon-Fri 9:00 AM - 6:00 PM)...'}
                className="flex-1 h-[50px] rounded-xl bg-white px-4 text-[14px] leading-normal text-gray-900 placeholder:text-gray-400 focus:placeholder-transparent outline-none shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/10 focus:border-black/10 focus:ring-0"
              />

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!(customInputs[item.id] || '').trim() || resolvingId === item.id}
                  onClick={() => {
                    const val = (customInputs[item.id] || '').trim();
                    if (val) onResolve(item, val);
                  }}
                  className="flex items-center justify-center h-[50px] rounded-xl bg-[#FF751F] hover:bg-[#e06518] px-5 text-sm font-semibold text-white shadow-none transition-colors cursor-pointer disabled:opacity-50"
                >
                  Save
                </button>

                {onAttachFile && (
                  <button
                    type="button"
                    disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                    onClick={() => onAttachFile(item)}
                    className="h-[50px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                    title="Or attach a document with this schedule"
                  >
                    <Paperclip className={`w-3.5 h-3.5 ${uploadingQuestionId === item.id ? 'animate-spin text-[#FF751F]' : ''}`} />
                    <span>Attach File</span>
                  </button>
                )}
              </div>
            </div>
          ) : item.inputType === 'boolean' ? (
            /* 2. BINARY YES / NO TOGGLE WITH '+ OTHER' AND ATTACH FILE */
            <>
              {!expandedCustomIds[item.id] ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
                  <div className="flex-1 flex flex-col sm:flex-row items-stretch gap-2 w-full">
                    <button
                      type="button"
                      disabled={resolvingId === item.id}
                      onClick={() => onResolve(item, 'Yes')}
                      className="flex-1 min-h-[46px] px-5 rounded-xl border border-black/10 bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                    >
                      <span>Yes</span>
                    </button>

                    <button
                      type="button"
                      disabled={resolvingId === item.id}
                      onClick={() => onResolve(item, 'No')}
                      className="flex-1 min-h-[46px] px-5 rounded-xl border border-black/10 bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center justify-center shadow-[0_1px_2px_rgba(0,0,0,0.03)]"
                    >
                      <span>No</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                    {onAttachFile && (
                      <button
                        type="button"
                        disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                        onClick={() => onAttachFile(item)}
                        className="h-[46px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                        title="Or attach a policy document"
                      >
                        <Paperclip className={`w-3.5 h-3.5 ${uploadingQuestionId === item.id ? 'animate-spin text-[#FF751F]' : ''}`} />
                        <span>Attach File</span>
                      </button>
                    )}

                    <button
                      type="button"
                      disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                      onClick={() =>
                        setExpandedCustomIds(prev => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      className="h-[46px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                    >
                      <span className="text-sm font-semibold leading-none">+</span>
                      <span>Other</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                  <input
                    type="text"
                    autoFocus
                    value={customInputs[item.id] || ''}
                    onChange={e =>
                      setCustomInputs(prev => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      } else if (e.key === 'Escape') {
                        setExpandedCustomIds(prev => ({ ...prev, [item.id]: false }));
                      }
                    }}
                    placeholder="Type details or explain in text..."
                    className="flex-1 h-[50px] rounded-xl bg-white px-4 text-[14px] leading-normal text-gray-900 placeholder:text-gray-400 focus:placeholder-transparent outline-none shadow-sm border border-black/10 focus:border-black/10 focus:ring-0"
                  />

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!(customInputs[item.id] || '').trim() || resolvingId === item.id}
                      onClick={() => {
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      }}
                      className="flex items-center justify-center h-[50px] rounded-xl bg-[#FF751F] hover:bg-[#e06518] px-5 text-sm font-semibold text-white shadow-none transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCustomIds(prev => ({
                          ...prev,
                          [item.id]: false,
                        }))
                      }
                      className="flex items-center justify-center h-[50px] rounded-xl border border-black/10 bg-white hover:bg-gray-50 px-4 text-xs sm:text-sm font-medium text-gray-600 hover:text-black transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : item.inputType === 'file' ? (
            /* 2. FILE MANDATED INPUT (e.g. brochures, menus, rate cards, floor plans) */
            <>
              {!expandedCustomIds[item.id] ? (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
                  {/* Flat Elongated Solid File Upload Card (No border, solid background) */}
                  <div className="relative flex-1 flex flex-col sm:flex-row items-stretch sm:items-center gap-3.5 p-3.5 rounded-xl bg-gray-100">
                    <div className="flex-1 flex items-center gap-3">
                      <Paperclip className="w-5 h-5 text-[#FF751F] shrink-0" />
                      <div>
                        <p className="text-xs sm:text-[13px] font-semibold text-gray-900 leading-snug">Document or Image Required</p>
                        <p className="text-[11px] text-gray-500">Attach PDF brochures, menus, or photos (multiple files supported)</p>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0">
                      <button
                        type="button"
                        disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                        onClick={() => onAttachFile && onAttachFile(item)}
                        className="flex items-center justify-center gap-1.5 h-[42px] px-4 rounded-xl border-none bg-white hover:bg-gray-50 text-xs sm:text-sm font-semibold text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-colors cursor-pointer disabled:opacity-40"
                      >
                        <Paperclip className={`w-3.5 h-3.5 ${uploadingQuestionId === item.id ? 'animate-spin text-[#FF751F]' : ''}`} />
                        <span>{uploadingQuestionId === item.id ? 'Attaching...' : 'Attach File'}</span>
                      </button>
                    </div>
                  </div>

                  {/* Basic "+ Other" action button outside the card */}
                  <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                    <button
                      type="button"
                      disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                      onClick={() =>
                        setExpandedCustomIds(prev => ({
                          ...prev,
                          [item.id]: true,
                        }))
                      }
                      className="h-[46px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                    >
                      <span className="text-sm font-semibold leading-none">+</span>
                      <span>Other</span>
                    </button>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                  <input
                    type="text"
                    autoFocus
                    value={customInputs[item.id] || ''}
                    onChange={e =>
                      setCustomInputs(prev => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      } else if (e.key === 'Escape') {
                        setExpandedCustomIds(prev => ({ ...prev, [item.id]: false }));
                      }
                    }}
                    placeholder="Type details or explain in text..."
                    className="flex-1 h-[50px] rounded-xl bg-white px-4 text-[14px] leading-normal text-gray-900 placeholder:text-gray-400 focus:placeholder-transparent outline-none shadow-sm border border-black/10 focus:border-black/10 focus:ring-0"
                  />

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!(customInputs[item.id] || '').trim() || resolvingId === item.id}
                      onClick={() => {
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      }}
                      className="flex items-center justify-center h-[50px] rounded-xl bg-[#FF751F] hover:bg-[#e06518] px-5 text-sm font-semibold text-white shadow-none transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCustomIds(prev => ({
                          ...prev,
                          [item.id]: false,
                        }))
                      }
                      className="flex items-center justify-center h-[50px] rounded-xl border border-black/10 bg-white hover:bg-gray-50 px-4 text-xs sm:text-sm font-medium text-gray-600 hover:text-black transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (!item.options || item.options.length === 0) ? (
            /* NEVER SHOW EMPTY ANSWER SPACES: Render text input if question has no multiple choice options */
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full">
              <input
                type="text"
                value={customInputs[item.id] || ''}
                onChange={e =>
                  setCustomInputs(prev => ({
                    ...prev,
                    [item.id]: e.target.value,
                  }))
                }
                onKeyDown={e => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    const val = (customInputs[item.id] || '').trim();
                    if (val) onResolve(item, val);
                  }
                }}
                placeholder={item.placeholder || 'Type answer (e.g. date, policy, or details)...'}
                className="flex-1 h-[50px] rounded-xl bg-white px-4 text-[14px] leading-normal text-gray-900 placeholder:text-gray-400 focus:placeholder-transparent outline-none shadow-[0_1px_3px_rgba(0,0,0,0.04)] border border-black/10 focus:border-black/10 focus:ring-0"
              />

              <div className="flex items-center gap-2 shrink-0">
                <button
                  type="button"
                  disabled={!(customInputs[item.id] || '').trim() || resolvingId === item.id}
                  onClick={() => {
                    const val = (customInputs[item.id] || '').trim();
                    if (val) onResolve(item, val);
                  }}
                  className="flex items-center justify-center h-[50px] rounded-xl bg-[#FF751F] hover:bg-[#e06518] px-5 text-sm font-semibold text-white shadow-none transition-colors cursor-pointer disabled:opacity-50"
                >
                  Save
                </button>

                {onAttachFile && (
                  <button
                    type="button"
                    disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                    onClick={() => onAttachFile(item)}
                    className="h-[50px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                    title="Or attach a file"
                  >
                    <Paperclip className={`w-3.5 h-3.5 ${uploadingQuestionId === item.id ? 'animate-spin text-[#FF751F]' : ''}`} />
                    <span>Attach File</span>
                  </button>
                )}
              </div>
            </div>
          ) : (
            /* 3. MULTIPLE CHOICE OPTIONS (default) */
            <>
              {!expandedCustomIds[item.id] ? (
                <div className="space-y-2.5 w-full">
                  <div className="flex flex-col sm:flex-row items-stretch sm:items-start gap-2.5 w-full">
                    {/* Dynamic options layout: stretches full width or wraps cleanly into responsive grid when many options */}
                    <div className={`flex-1 ${
                      item.options.length > 3
                        ? 'grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-2 w-full'
                        : 'flex flex-col sm:flex-row items-stretch gap-2 w-full'
                    }`}>
                      {item.options.map((rawOption, idx) => {
                        const option = cleanOptionLabel(rawOption);
                        const isSelected = currentSelected.includes(rawOption) || currentSelected.includes(option);
                        return (
                          <button
                            key={idx}
                            disabled={resolvingId === item.id}
                            onClick={() => {
                              if (isMulti) {
                                toggleOption(option);
                              } else {
                                onResolve(item, option);
                              }
                            }}
                            className={`flex-1 min-h-[46px] px-4 py-2.5 rounded-xl text-xs sm:text-[13px] font-medium transition-all cursor-pointer disabled:opacity-40 flex items-center ${
                              isMulti ? 'justify-start' : 'justify-center text-center'
                            } gap-2 ${
                              isSelected
                                ? 'bg-orange-50 border-2 border-[#FF751F] text-gray-900 shadow-sm'
                                : 'bg-white border border-black/10 hover:bg-gray-50 text-gray-800 shadow-[0_1px_2px_rgba(0,0,0,0.03)]'
                            }`}
                          >
                            {isMulti && (
                              <div
                                className={`w-4 h-4 rounded flex items-center justify-center shrink-0 transition-colors ${
                                  isSelected ? 'bg-[#FF751F] text-white' : 'border border-gray-300 bg-white'
                                }`}
                              >
                                {isSelected && (
                                  <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                  </svg>
                                )}
                              </div>
                            )}
                            <span className="leading-snug">{option}</span>
                          </button>
                        );
                      })}
                    </div>

                    {/* Action Buttons: Confirm Selection (if multi) + Attach File + Other */}
                    <div className="flex items-center gap-1.5 shrink-0 self-start sm:self-auto">
                      {isMulti && currentSelected.length > 0 && (
                        <button
                          type="button"
                          disabled={resolvingId === item.id}
                          onClick={handleConfirmMulti}
                          className="h-[46px] px-4 rounded-xl bg-[#FF751F] hover:bg-[#e06518] text-xs sm:text-sm font-semibold text-white transition-colors cursor-pointer shadow-sm flex items-center gap-1.5"
                        >
                          <span>Confirm ({currentSelected.length})</span>
                        </button>
                      )}

                      {onAttachFile && (
                        <button
                          type="button"
                          disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                          onClick={() => onAttachFile(item)}
                          className="h-[46px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                          title="Attach a PDF or image document for this question"
                        >
                          <Paperclip className={`w-3.5 h-3.5 ${uploadingQuestionId === item.id ? 'animate-spin text-[#FF751F]' : ''}`} />
                          <span>{uploadingQuestionId === item.id ? 'Attaching...' : 'Attach File'}</span>
                        </button>
                      )}

                      <button
                        type="button"
                        disabled={resolvingId === item.id || uploadingQuestionId === item.id}
                        onClick={() =>
                          setExpandedCustomIds(prev => ({
                            ...prev,
                            [item.id]: true,
                          }))
                        }
                        className="h-[46px] px-2.5 rounded-xl bg-transparent text-xs sm:text-[13px] font-medium text-gray-500 hover:text-gray-900 transition-colors cursor-pointer disabled:opacity-40 flex items-center gap-1.5 justify-center"
                      >
                        <span className="text-sm font-semibold leading-none">+</span>
                        <span>Other</span>
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2 w-full">
                  <input
                    type="text"
                    autoFocus
                    value={customInputs[item.id] || ''}
                    onChange={e =>
                      setCustomInputs(prev => ({
                        ...prev,
                        [item.id]: e.target.value,
                      }))
                    }
                    onKeyDown={e => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      } else if (e.key === 'Escape') {
                        setExpandedCustomIds(prev => ({ ...prev, [item.id]: false }));
                      }
                    }}
                    placeholder="Type your custom answer..."
                    className="flex-1 h-[50px] rounded-xl bg-white px-4 text-[14px] leading-normal text-gray-900 placeholder:text-gray-400 focus:placeholder-transparent outline-none shadow-sm border border-black/10 focus:border-black/10 focus:ring-0"
                  />

                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      type="button"
                      disabled={!(customInputs[item.id] || '').trim() || resolvingId === item.id}
                      onClick={() => {
                        const val = (customInputs[item.id] || '').trim();
                        if (val) onResolve(item, val);
                      }}
                      className="flex items-center justify-center h-[50px] rounded-xl bg-[#FF751F] hover:bg-[#e06518] px-5 text-sm font-semibold text-white shadow-none transition-colors cursor-pointer disabled:opacity-50"
                    >
                      Save
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        setExpandedCustomIds(prev => ({
                          ...prev,
                          [item.id]: false,
                        }))
                      }
                      className="flex items-center justify-center h-[50px] rounded-xl border border-black/10 bg-white hover:bg-gray-50 px-4 text-xs sm:text-sm font-medium text-gray-600 hover:text-black transition-colors cursor-pointer"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              )}
            </>
          )}

        </>
      )}

      {/* Render Nested Sub-questions with left accent boundary */}
      {hasSubQuestions && (
        <div className="mt-1.5 ml-2 sm:ml-3 pl-2.5 sm:pl-3 border-l-2 border-[#FF751F] space-y-2">
          {item.subQuestions!.map(sub => (
            <QuestionRow
              key={sub.id}
              item={sub}
              resolvingId={resolvingId}
              uploadingQuestionId={uploadingQuestionId}
              expandedCustomIds={expandedCustomIds}
              setExpandedCustomIds={setExpandedCustomIds}
              customInputs={customInputs}
              setCustomInputs={setCustomInputs}
              selectedMultiOptions={selectedMultiOptions}
              setSelectedMultiOptions={setSelectedMultiOptions}
              onResolve={onResolve}
              onDismiss={onDismiss}
              onAttachFile={onAttachFile}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}
