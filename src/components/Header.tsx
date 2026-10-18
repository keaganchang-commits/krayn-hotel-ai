'use client';

import React from 'react';
import { Plus, Zap, Trash2, Power, RefreshCw } from 'lucide-react';

export default function Header({
  title,
  statusMessage,
  onUploadPdf,
  onAutoReply,
  onToggleAutoReply,
  onClearKnowledge,
  onCompose,
  onScanGaps,
  isSyncing = false,
  isUploading = false,
  isAutoReplying = false,
  isClearing = false,
  isScanningGaps = false,
  autoReplyEnabled = true,
}: {
  title: string;
  statusMessage?: string | null;
  onUploadPdf?: () => void;
  onAutoReply?: () => void;
  onToggleAutoReply?: () => void;
  onClearKnowledge?: () => void;
  onCompose?: () => void;
  onScanGaps?: () => void;
  isSyncing?: boolean;
  isUploading?: boolean;
  isAutoReplying?: boolean;
  isClearing?: boolean;
  isScanningGaps?: boolean;
  autoReplyEnabled?: boolean;
}) {
  return (
    <header className="h-14 bg-white border-b border-[#E5E5E7] px-6 flex items-center justify-between z-10 shrink-0">
      <h2 className="text-sm font-semibold text-gray-900 tracking-tight">{title}</h2>

      <div className="flex items-center gap-2">
        {statusMessage && (
          <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1 rounded-full border border-emerald-200/60 font-medium shadow-none">
            {statusMessage}
          </span>
        )}

        {onClearKnowledge && (
          <button
            onClick={onClearKnowledge}
            disabled={isClearing}
            className="flex items-center gap-1.5 rounded-lg bg-white hover:bg-red-50 hover:text-red-600 border border-[#E5E5E7] px-3.5 py-2 text-xs font-semibold text-gray-700 transition-all cursor-pointer disabled:opacity-50"
          >
            <Trash2 className="w-3.5 h-3.5 text-red-500" />
            <span className="hidden md:inline">{isClearing ? 'Clearing Memory...' : 'Clear All Knowledge'}</span>
          </button>
        )}
        {onUploadPdf && (
          <button
            onClick={onUploadPdf}
            disabled={isUploading}
            className="flex items-center gap-1.5 rounded-lg bg-white hover:bg-gray-50 border border-[#E5E5E7] px-3.5 py-2 text-xs font-semibold text-gray-800 transition-all cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5 text-indigo-600" />
            <span className="hidden sm:inline">{isUploading ? 'Indexing PDF...' : 'Upload PDF'}</span>
          </button>
        )}
        {onAutoReply && autoReplyEnabled && (
          <button
            onClick={onAutoReply}
            disabled={isAutoReplying}
            className="flex items-center gap-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 px-3.5 py-2 text-xs font-semibold text-white shadow-none transition-all cursor-pointer disabled:opacity-50"
          >
            <Zap className={`w-3.5 h-3.5 ${isAutoReplying ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">{isAutoReplying ? 'Replying...' : 'Auto-Reply Inbox'}</span>
          </button>
        )}
        {onScanGaps && (
          <button
            onClick={onScanGaps}
            disabled={isScanningGaps}
            className="flex items-center gap-1.5 rounded-lg bg-white hover:bg-gray-50 border border-[#E5E5E7] px-3.5 py-1.5 text-xs font-semibold text-gray-800 transition-all cursor-pointer disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 text-gray-600 ${isScanningGaps ? 'animate-spin text-[#FF751F]' : ''}`} />
            <span>{isScanningGaps ? 'Refreshing...' : 'Refresh'}</span>
          </button>
        )}
      </div>
    </header>
  );
}
