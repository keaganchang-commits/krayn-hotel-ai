'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  Activity,
  BookOpen,
  Mail,
  HelpCircle,
  Calendar,
  Search,
  RefreshCw,
  Clock,
  Filter,
  CheckCircle2,
  AlertCircle
} from 'lucide-react';

interface AuditLogItem {
  id: string;
  timestamp: string;
  category: 'learning' | 'reply' | 'clarification' | 'dining' | 'system';
  action: string;
  title: string;
  details: string;
  metadata?: Record<string, any>;
}

export default function ActivityLogsPage() {
  const [logs, setLogs] = useState<AuditLogItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<'all' | 'learning' | 'reply' | 'clarification' | 'dining'>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [syncNotice, setSyncNotice] = useState<string | null>(null);

  const fetchLogs = async () => {
    setIsLoading(true);
    try {
      const params = new URLSearchParams();
      if (selectedCategory !== 'all') params.set('category', selectedCategory);
      if (searchQuery.trim()) params.set('search', searchQuery.trim());

      const res = await fetch(`/api/audit?${params.toString()}`);
      const data = await res.json();
      if (data.success) {
        setLogs(data.logs || []);
      }
    } catch (err) {
      console.error('Failed to load audit logs:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();
  }, [selectedCategory]);

  const handleManualSync = async () => {
    setIsSyncing(true);
    setSyncNotice(null);
    try {
      const res = await fetch('/api/gmail/sync', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setSyncNotice(data.syncedCount > 0
          ? `Learned ${data.syncedCount} new operational fact(s) from email replies!`
          : 'Inbox synced. No new replied customer threads found to learn from.'
        );
        fetchLogs();
      } else {
        setSyncNotice(data.error || 'Sync check completed.');
      }
    } catch (err) {
      setSyncNotice('Failed to trigger manual learning sync.');
    } finally {
      setIsSyncing(false);
      setTimeout(() => setSyncNotice(null), 5000);
    }
  };

  const getCategoryBadge = (category: string) => {
    switch (category) {
      case 'learning':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200/60">
            <BookOpen className="w-3 h-3 text-emerald-600" />
            Learning
          </span>
        );
      case 'reply':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-blue-50 text-blue-700 border border-blue-200/60">
            <Mail className="w-3 h-3 text-blue-600" />
            Auto-Reply
          </span>
        );
      case 'clarification':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-purple-50 text-purple-700 border border-purple-200/60">
            <HelpCircle className="w-3 h-3 text-purple-600" />
            Clarification
          </span>
        );
      case 'dining':
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-amber-50 text-amber-700 border border-amber-200/60">
            <Calendar className="w-3 h-3 text-amber-600" />
            Dining Agent
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-gray-50 text-gray-700 border border-gray-200/60">
            <Activity className="w-3 h-3 text-gray-600" />
            System
          </span>
        );
    }
  };

  const formatDate = (iso: string) => {
    try {
      const d = new Date(iso);
      return d.toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      });
    } catch {
      return iso;
    }
  };

  return (
    <div className="flex h-screen bg-[#F5F5F7] font-sans antialiased text-[#1C1C1E] overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-y-auto">
        <div className="max-w-5xl w-full mx-auto p-4 md:p-8 space-y-6">
          {/* Header */}
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-black text-white flex items-center justify-center shadow-sm">
                  <Activity className="w-5 h-5" />
                </div>
                <h1 className="text-2xl font-bold tracking-tight text-[#111827]">
                  Activity & Audit Logs
                </h1>
              </div>
              <p className="text-sm text-[#86868B] mt-1">
                Real-time records of AI learnings, automated email replies, and policy clarifications.
              </p>
            </div>

            <button
              onClick={handleManualSync}
              disabled={isSyncing}
              className="inline-flex items-center justify-center gap-2 px-4 py-2 bg-black text-white rounded-xl text-sm font-semibold hover:bg-[#2C2C2E] transition-all disabled:opacity-50 shadow-sm self-start sm:self-auto cursor-pointer"
            >
              <RefreshCw className={`w-4 h-4 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Syncing...' : 'Sync & Learn Now'}
            </button>
          </div>

          {/* Sync Notice Alert */}
          {syncNotice && (
            <div className="p-3.5 bg-emerald-50 border border-emerald-200/70 text-emerald-800 rounded-2xl text-sm flex items-center gap-2 shadow-sm animate-in fade-in duration-200">
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{syncNotice}</span>
            </div>
          )}

          {/* Search & Category Filter Controls */}
          <div className="bg-white rounded-2xl p-3 border border-[#E5E5EA] shadow-sm flex flex-col md:flex-row gap-3 items-stretch md:items-center justify-between">
            {/* Search Input */}
            <div className="relative flex-1">
              <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-[#86868B]" />
              <input
                type="text"
                placeholder="Search logs by keyword, topic, or recipient..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && fetchLogs()}
                className="w-full pl-9 pr-3.5 py-2 text-sm bg-[#F5F5F7] rounded-xl border-none focus:outline-none focus:ring-2 focus:ring-black text-[#1C1C1E]"
              />
            </div>

            {/* Category Filter Tabs */}
            <div className="flex items-center gap-1 overflow-x-auto pb-1 md:pb-0 scrollbar-none">
              {(
                [
                  { id: 'all', label: 'All Events' },
                  { id: 'learning', label: 'Learnings' },
                  { id: 'reply', label: 'Auto-Replies' },
                  { id: 'clarification', label: 'Clarifications' },
                  { id: 'dining', label: 'Dining' },
                ] as const
              ).map(cat => (
                <button
                  key={cat.id}
                  onClick={() => setSelectedCategory(cat.id)}
                  className={`px-3 py-1.5 rounded-lg text-xs font-semibold whitespace-nowrap transition-all cursor-pointer ${
                    selectedCategory === cat.id
                      ? 'bg-black text-white shadow-xs'
                      : 'text-[#636366] hover:bg-[#F2F2F7] hover:text-[#1C1C1E]'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
          </div>

          {/* Logs List Container */}
          <div className="bg-white rounded-2xl border border-[#E5E5EA] shadow-sm overflow-hidden divide-y divide-[#F2F2F7]">
            {isLoading ? (
              <div className="p-12 text-center text-[#86868B] text-sm flex flex-col items-center justify-center gap-3">
                <RefreshCw className="w-6 h-6 animate-spin text-[#86868B]" />
                <span>Loading activity log records...</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="p-12 text-center text-[#86868B] text-sm flex flex-col items-center justify-center gap-2">
                <Activity className="w-8 h-8 text-[#D1D1D6] mb-1" />
                <span className="font-semibold text-[#1C1C1E]">No audit logs recorded yet</span>
                <span className="text-xs max-w-sm text-[#86868B]">
                  Learned facts from email replies and autonomous actions will automatically appear here.
                </span>
              </div>
            ) : (
              logs.map(log => (
                <div
                  key={log.id}
                  className="p-4 md:p-5 hover:bg-[#FAFAFA] transition-colors flex flex-col sm:flex-row sm:items-start justify-between gap-3"
                >
                  <div className="space-y-1.5 flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {getCategoryBadge(log.category)}
                      <span className="text-xs font-medium text-[#86868B]">
                        {log.action}
                      </span>
                    </div>

                    <h3 className="text-sm font-semibold text-[#111827] truncate">
                      {log.title}
                    </h3>

                    <p className="text-xs leading-relaxed text-[#48484A] break-words">
                      {log.details}
                    </p>

                    {log.metadata && Object.keys(log.metadata).length > 0 && (
                      <div className="pt-1 flex flex-wrap gap-2 text-[11px] text-[#86868B]">
                        {log.metadata.sender && (
                          <span className="bg-[#F2F2F7] px-2 py-0.5 rounded-md font-mono">
                            From: {log.metadata.sender}
                          </span>
                        )}
                        {log.metadata.confidenceScore && (
                          <span className="bg-[#F2F2F7] px-2 py-0.5 rounded-md font-mono">
                            Confidence: {log.metadata.confidenceScore}%
                          </span>
                        )}
                        {log.metadata.threadId && (
                          <span className="bg-[#F2F2F7] px-2 py-0.5 rounded-md font-mono">
                            Thread: {log.metadata.threadId.slice(0, 8)}...
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="flex items-center gap-1.5 text-xs text-[#86868B] shrink-0 self-end sm:self-start">
                    <Clock className="w-3.5 h-3.5" />
                    <span>{formatDate(log.timestamp)}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
