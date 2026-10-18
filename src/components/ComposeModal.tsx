'use client';

import React, { useState, useEffect } from 'react';
import {
  X,
  Send,
  Sparkles,
  Loader2,
  Bold,
  Italic,
  List,
  Link2,
  CheckCircle2,
  AlertCircle,
  Wand2,
  Minus,
  Maximize2,
  Minimize2
} from 'lucide-react';

interface ComposeModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTo?: string;
  initialSubject?: string;
  initialBody?: string;
  threadId?: string;
  inReplyToMsgId?: string;
  draftId?: string;
  onEmailSent?: () => void;
  onDraftSaved?: () => void;
}

export default function ComposeModal({
  isOpen,
  onClose,
  initialTo = '',
  initialSubject = '',
  initialBody = '',
  threadId,
  inReplyToMsgId,
  draftId,
  onEmailSent,
  onDraftSaved,
}: ComposeModalProps) {
  const [to, setTo] = useState(initialTo);
  const [subject, setSubject] = useState(initialSubject);
  const [body, setBody] = useState(initialBody);

  const [isSending, setIsSending] = useState(false);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isAiGenerating, setIsAiGenerating] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [showAiPromptInput, setShowAiPromptInput] = useState(false);

  // Window states: 'normal' (bottom-right ~560px), 'maximized' (expanded center), 'minimized' (collapsed bottom bar)
  const [windowState, setWindowState] = useState<'normal' | 'maximized' | 'minimized'>('normal');

  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTo(initialTo);
      setSubject(initialSubject);
      setBody(initialBody);
      setStatus(null);
      setAiPrompt('');
      setShowAiPromptInput(false);
      setWindowState('normal');
    }
  }, [isOpen, initialTo, initialSubject, initialBody]);

  if (!isOpen) return null;

  const handleSend = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!to.trim() || !subject.trim() || !body.trim()) {
      setStatus({ type: 'error', message: 'Please fill in Recipient, Subject, and Email Body.' });
      return;
    }

    setIsSending(true);
    setStatus(null);

    try {
      const res = await fetch('/api/gmail/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          threadId,
          inReplyToMsgId,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus({ type: 'success', message: 'Email sent successfully via Gmail!' });
        setTimeout(() => {
          onClose();
          if (onEmailSent) onEmailSent();
        }, 1000);
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to send email.' });
      }
    } catch (err: any) {
      console.error('Send email error:', err);
      setStatus({ type: 'error', message: err.message || 'Error communicating with Gmail service.' });
    } finally {
      setIsSending(false);
    }
  };

  const handleSaveDraft = async () => {
    if (!to.trim() && !subject.trim() && !body.trim()) {
      setStatus({ type: 'error', message: 'Draft is completely empty.' });
      return;
    }

    setIsSavingDraft(true);
    setStatus(null);

    try {
      const res = await fetch('/api/gmail/drafts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: to.trim(),
          subject: subject.trim(),
          body: body.trim(),
          threadId,
          inReplyToMsgId,
        }),
      });

      const data = await res.json();

      if (data.success) {
        setStatus({ type: 'success', message: 'Draft saved successfully!' });
        if (onDraftSaved) onDraftSaved();
        setTimeout(() => setStatus(null), 3000);
      } else {
        setStatus({ type: 'error', message: data.error || 'Failed to save draft.' });
      }
    } catch (err: any) {
      console.error('Save draft error:', err);
      setStatus({ type: 'error', message: err.message || 'Error saving draft.' });
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleGenerateAiDraft = async (type: 'generate' | 'polish') => {
    setIsAiGenerating(true);
    setStatus(null);

    try {
      const res = await fetch('/api/ai/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recipient: to.trim(),
          subject: subject.trim(),
          userPrompt: aiPrompt.trim(),
          existingBody: body.trim(),
          taskType: type,
        }),
      });

      const data = await res.json();

      if (data.success && data.draft) {
        setBody(data.draft);
        if (data.subject && !subject.trim()) {
          setSubject(data.subject);
        }
        setShowAiPromptInput(false);
        setStatus({
          type: 'success',
          message: type === 'polish' ? 'Email draft polished by AI!' : 'New draft generated by AI!',
        });
      } else {
        setStatus({ type: 'error', message: data.error || 'AI generation failed.' });
      }
    } catch (err: any) {
      console.error('AI Draft error:', err);
      setStatus({ type: 'error', message: err.message || 'Error communicating with AI.' });
    } finally {
      setIsAiGenerating(false);
    }
  };

  const applyFormatting = (prefix: string, suffix: string = '') => {
    setBody(prev => `${prev}${prefix}${suffix}`);
  };

  // 1. Minimized View (Floating Bottom Bar Tab)
  if (windowState === 'minimized') {
    return (
      <div className="fixed bottom-0 right-4 sm:right-8 z-50 w-72 bg-[#1E1E1E] text-white rounded-t-xl shadow-2xl flex items-center justify-between px-3.5 py-2.5 border border-black/10 select-none animate-in slide-in-from-bottom duration-150">
        <button
          onClick={() => setWindowState('normal')}
          className="flex-1 text-left truncate font-medium text-xs hover:text-gray-200 cursor-pointer pr-2"
        >
          {subject || (threadId ? 'Reply' : 'New Message')}
        </button>

        <div className="flex items-center gap-1.5 shrink-0">
          <button
            onClick={() => setWindowState('normal')}
            className="p-1 text-gray-400 hover:text-white rounded transition-colors cursor-pointer"
            title="Expand"
          >
            <Maximize2 className="w-3.5 h-3.5" />
          </button>
          <button
            onClick={onClose}
            className="p-1 text-gray-400 hover:text-white rounded transition-colors cursor-pointer"
            title="Close"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    );
  }

  // 2. Normal or Maximized Floating Window (Docked at Bottom-Right just like Gmail)
  const containerClasses =
    windowState === 'maximized'
      ? 'fixed inset-4 sm:inset-10 z-50 bg-white rounded-2xl shadow-2xl border border-[#E5E5E7] flex flex-col overflow-hidden animate-in zoom-in-95 duration-150'
      : 'fixed bottom-0 right-2 sm:right-6 z-50 w-[95vw] sm:w-[560px] md:w-[600px] h-[540px] max-h-[85vh] bg-white rounded-t-2xl shadow-[0_-4px_30px_rgba(0,0,0,0.18)] border border-[#D1D1D6] flex flex-col overflow-hidden animate-in slide-in-from-bottom duration-200';

  return (
    <div className={containerClasses}>
      {/* Gmail-style Dark Header Bar with Controls */}
      <div className="bg-[#2B2B2B] text-white px-4 py-2.5 flex items-center justify-between select-none shrink-0">
        <span className="text-xs font-semibold tracking-tight truncate">
          {threadId ? 'Reply to Email' : 'New Message'}
        </span>

        <div className="flex items-center gap-1.5 text-gray-300">
          <button
            type="button"
            onClick={() => setWindowState('minimized')}
            className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
            title="Minimize"
          >
            <Minus className="w-3.5 h-3.5" />
          </button>

          <button
            type="button"
            onClick={() => setWindowState(s => (s === 'maximized' ? 'normal' : 'maximized'))}
            className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer"
            title={windowState === 'maximized' ? 'Exit Full Screen' : 'Full Screen'}
          >
            {windowState === 'maximized' ? (
              <Minimize2 className="w-3.5 h-3.5" />
            ) : (
              <Maximize2 className="w-3.5 h-3.5" />
            )}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="p-1 hover:text-white hover:bg-white/10 rounded transition-colors cursor-pointer ml-1"
            title="Save and Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Status banner if active */}
      {status && (
        <div
          className={`px-4 py-2 text-xs flex items-center gap-2 shrink-0 ${
            status.type === 'success'
              ? 'bg-emerald-50 text-emerald-800 border-b border-emerald-200'
              : 'bg-red-50 text-red-800 border-b border-red-200'
          }`}
        >
          {status.type === 'success' ? (
            <CheckCircle2 className="w-3.5 h-3.5 shrink-0 text-emerald-600" />
          ) : (
            <AlertCircle className="w-3.5 h-3.5 shrink-0 text-red-600" />
          )}
          <span className="truncate">{status.message}</span>
        </div>
      )}

      {/* Main Email Composition Body */}
      <div className="flex-1 flex flex-col p-4 overflow-y-auto space-y-3 bg-white text-gray-900 font-sans">
        {/* Recipient Input */}
        <div className="flex items-center gap-2 border-b border-[#E5E5E7] pb-2">
          <label className="text-xs font-medium text-gray-500 w-14 shrink-0">To</label>
          <input
            type="email"
            value={to}
            onChange={e => setTo(e.target.value)}
            placeholder="Recipient email address..."
            required
            className="flex-1 text-xs bg-transparent focus:outline-none text-gray-900 placeholder:text-gray-400"
          />
        </div>

        {/* Subject Input */}
        <div className="flex items-center gap-2 border-b border-[#E5E5E7] pb-2">
          <label className="text-xs font-medium text-gray-500 w-14 shrink-0">Subject</label>
          <input
            type="text"
            value={subject}
            onChange={e => setSubject(e.target.value)}
            placeholder="Subject line..."
            required
            className="flex-1 text-xs bg-transparent focus:outline-none font-semibold text-gray-900 placeholder:text-gray-400"
          />
        </div>

        {/* AI Smart Assist Toolbar */}
        <div className="p-2.5 rounded-xl bg-gradient-to-r from-orange-50/70 to-amber-50/40 border border-orange-200/60">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-900">
              <Sparkles className="w-3.5 h-3.5 text-[#FF751F]" />
              <span>AI Email Assistant</span>
            </div>
            <div className="flex items-center gap-1.5">
              {body.trim() && (
                <button
                  type="button"
                  onClick={() => handleGenerateAiDraft('polish')}
                  disabled={isAiGenerating}
                  className="px-2.5 py-1 bg-white hover:bg-gray-50 border border-[#E5E5E7] text-gray-800 rounded-lg text-[11px] font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
                >
                  {isAiGenerating ? (
                    <Loader2 className="w-3 h-3 animate-spin text-[#FF751F]" />
                  ) : (
                    <Wand2 className="w-3 h-3 text-[#FF751F]" />
                  )}
                  <span>Polish</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setShowAiPromptInput(!showAiPromptInput)}
                className="px-2.5 py-1 bg-[#FF751F] hover:bg-[#E6650F] text-white rounded-lg text-[11px] font-semibold transition-colors flex items-center gap-1.5 cursor-pointer shadow-2xs"
              >
                <Sparkles className="w-3 h-3" />
                <span>{showAiPromptInput ? 'Hide AI' : 'Draft with AI'}</span>
              </button>
            </div>
          </div>

          {showAiPromptInput && (
            <div className="pt-2 flex flex-col sm:flex-row gap-2 animate-in fade-in duration-150">
              <input
                type="text"
                value={aiPrompt}
                onChange={e => setAiPrompt(e.target.value)}
                placeholder="e.g. Apologize for delay, confirm reservation on 15 Oct..."
                className="flex-1 bg-white border border-[#E5E5E7] rounded-lg px-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-[#FF751F]"
              />
              <button
                type="button"
                onClick={() => handleGenerateAiDraft('generate')}
                disabled={isAiGenerating}
                className="px-3 py-1.5 bg-[#1D1D1F] hover:bg-[#333336] text-white rounded-lg text-xs font-semibold transition-colors flex items-center justify-center gap-1.5 disabled:opacity-50 shrink-0 cursor-pointer"
              >
                {isAiGenerating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Generate'}
              </button>
            </div>
          )}
        </div>

        {/* Text Formatting Toolbar */}
        <div className="flex items-center gap-1 border-b border-[#E5E5E7] pb-1.5 text-gray-500">
          <button
            type="button"
            onClick={() => applyFormatting('**', '**')}
            className="p-1.5 rounded-md hover:bg-gray-100 hover:text-gray-900 text-xs font-semibold cursor-pointer"
            title="Bold"
          >
            <Bold className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('*', '*')}
            className="p-1.5 rounded-md hover:bg-gray-100 hover:text-gray-900 cursor-pointer"
            title="Italic"
          >
            <Italic className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('\n- ')}
            className="p-1.5 rounded-md hover:bg-gray-100 hover:text-gray-900 cursor-pointer"
            title="Bullet List"
          >
            <List className="w-3.5 h-3.5" />
          </button>
          <button
            type="button"
            onClick={() => applyFormatting('[', '](https://)')}
            className="p-1.5 rounded-md hover:bg-gray-100 hover:text-gray-900 cursor-pointer"
            title="Insert Link"
          >
            <Link2 className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Email Body Area */}
        <div className="flex-1 min-h-[160px]">
          <textarea
            value={body}
            onChange={e => setBody(e.target.value)}
            placeholder="Write your email reply or message here..."
            required
            rows={10}
            className="w-full h-full min-h-[160px] text-xs bg-transparent focus:outline-none resize-none text-gray-900 leading-relaxed placeholder:text-gray-400"
          />
        </div>
      </div>

      {/* Gmail-Style Action Footer with Big Solid Send Button */}
      <div className="px-4 py-3 bg-[#F9F9FA] border-t border-[#E5E5E7] flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={handleSend}
            disabled={isSending || isSavingDraft}
            className="flex items-center gap-1.5 px-5 py-2 bg-[#FF751F] hover:bg-[#E6650F] text-white text-xs font-semibold rounded-lg shadow-xs transition-colors disabled:opacity-50 cursor-pointer"
          >
            {isSending ? (
              <>
                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                <span>Sending...</span>
              </>
            ) : (
              <>
                <span>Send</span>
                <Send className="w-3.5 h-3.5" />
              </>
            )}
          </button>

          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft || isSending}
            className="px-3.5 py-2 rounded-lg border border-[#E5E5E7] text-xs font-medium text-gray-700 bg-white hover:bg-gray-100 transition-colors disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            {isSavingDraft ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin text-[#FF751F]" />
            ) : (
              'Save Draft'
            )}
          </button>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="text-xs text-gray-500 hover:text-gray-800 px-2 py-1 transition-colors cursor-pointer"
        >
          Discard
        </button>
      </div>
    </div>
  );
}
