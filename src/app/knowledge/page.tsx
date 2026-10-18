'use client';

import React, { useState, useRef, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import ComposeModal from '@/components/ComposeModal';
import {
  Trash2,
  Edit3,
  RefreshCw,
  BookOpen,
  Upload,
  FileText,
  ExternalLink,
  Mic,
  HelpCircle,
  Mail,
} from 'lucide-react';

interface KnowledgeItem {
  id: string;
  text: string;
  source: 'gmail' | 'pdf' | 'user_teaching' | 'clarification';
  title: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export default function KnowledgePage() {
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const [isClearing, setIsClearing] = useState(false);
  const [isComposeOpen, setIsComposeOpen] = useState(false);

  // Inline Row Edit State
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [editTitle, setEditTitle] = useState('');

  const [assets, setAssets] = useState<Array<{ id: string; name: string; filename: string }>>([]);

  const fileInputRef = useRef<HTMLInputElement>(null);

  const fetchKnowledgeItems = async (isInitial = false) => {
    if (isInitial) {
      setIsLoading(true);
    }
    try {
      const [knowRes, assetRes] = await Promise.all([
        fetch('/api/knowledge?source=all'),
        fetch('/api/assets'),
      ]);
      const data = await knowRes.json();
      if (data.success) {
        setItems(data.items || []);
      }
      const assetData = await assetRes.json().catch(() => ({}));
      if (assetData.success && Array.isArray(assetData.assets)) {
        setAssets(assetData.assets);
      }
    } catch (err) {
      console.error('Failed to fetch knowledge items:', err);
    } finally {
      if (isInitial) {
        setIsLoading(false);
      }
    }
  };

  useEffect(() => {
    fetchKnowledgeItems(true);
    const interval = setInterval(() => fetchKnowledgeItems(false), 8000);
    return () => clearInterval(interval);
  }, []);

  const handleClearAllKnowledge = async () => {
    if (
      !confirm(
        'Are you sure you want to completely clear ALL stored knowledge from vector memory? This action cannot be undone.'
      )
    ) {
      return;
    }

    setIsClearing(true);
    try {
      const res = await fetch('/api/knowledge/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        setStatusMessage(data.message || 'All knowledge cleared successfully.');
        setItems([]);
        try {
          localStorage.removeItem('answered_onboarding_ids');
          localStorage.removeItem('answered_question_norms');
          localStorage.removeItem('cached_clarifications_list');
        } catch (e) {}
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.error('Failed to clear knowledge:', err);
    } finally {
      setIsClearing(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploading(true);
    const formData = new FormData();
    formData.append('file', file);

    try {
      const res = await fetch('/api/documents/upload', {
        method: 'POST',
        body: formData,
      });
      const data = await res.json();

      if (data.success) {
        setStatusMessage(data.message || `Uploaded and indexed "${file.name}"`);
        await fetchKnowledgeItems();
        setTimeout(() => setStatusMessage(null), 4000);
      } else {
        alert(data.error || 'Failed to upload document');
      }
    } catch (err) {
      console.error('PDF upload failed:', err);
    } finally {
      setIsUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDeleteItem = async (id: string) => {
    // Immediate deletion without confirmation popup
    setItems(prev => prev.filter(item => item.id !== id));
    if (editingId === id) setEditingId(null);
    setStatusMessage('Rule deleted.');

    try {
      await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      });
      setTimeout(() => setStatusMessage(null), 2500);
    } catch (err) {
      console.error('Delete error:', err);
    }
  };

  const handleStartEdit = (item: KnowledgeItem, topic: string, detail: string) => {
    setEditingId(item.id);
    setEditText(detail);
    setEditTitle(topic);
  };

  const handleSaveEdit = async (id: string) => {
    if (!editText.trim()) return;

    try {
      const res = await fetch('/api/knowledge', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id,
          text: editText.trim(),
          title: editTitle.trim(),
        }),
      });
      const data = await res.json();

      if (data.success) {
        setStatusMessage('Rule updated successfully.');
        setEditingId(null);
        await fetchKnowledgeItems();
        setTimeout(() => setStatusMessage(null), 3000);
      }
    } catch (err) {
      console.error('Edit error:', err);
    }
  };

  // Clean up Topic and Detail for clean display
  const parseKnowledgeRow = (item: KnowledgeItem) => {
    let topic = item.metadata?.topic || item.title || 'General';
    let detail = item.metadata?.detail || item.text || '';

    if (!item.metadata?.detail) {
      const clarifyMatch = detail.match(/Regarding ["“](.+?)["”],\s*the confirmed answer is:\s*(.+)/i);
      if (clarifyMatch) {
        topic = clarifyMatch[1].trim();
        detail = clarifyMatch[2].trim();
      } else {
        const topicMatch = detail.match(/Topic:\s*([^:]+)\s*Rule:\s*(.+)/i);
        if (topicMatch) {
          topic = topicMatch[1].trim();
          detail = topicMatch[2].trim();
        } else {
          const colonMatch = detail.match(/^([^:\n]+):\s*(.+)$/);
          if (colonMatch && colonMatch[1].length < 35) {
            topic = colonMatch[1].trim();
            detail = colonMatch[2].trim();
          }
        }
      }
    }

    // Clean any residual AI system prefix artifacts or audit tags
    topic = topic
      .replace(/^\[AUDIT[^\]]*\]:?\s*/i, '')
      .replace(/^Audit:\s*/i, '')
      .replace(/^Rule:\s*/i, '')
      .replace(/^Document Fact:\s*/i, '')
      .replace(/^Email Fact:\s*/i, '')
      .trim();

    detail = detail
      .replace(/^\[AUDIT[^\]]*\]:?\s*/i, '')
      .replace(/^Audit:\s*/i, '')
      .trim();

    // Make individual rule titles punchy, natural, and straightforward
    topic = topic
      .replace(/^(Official|Estimated|Standard|General)\s+/i, '')
      .replace(/\s+(Specifications|Facilities|Procedures|Protocol|Guidelines|Inventory|Measures|Features)$/i, '')
      .replace(/Pool Specifications/i, 'Pool Size')
      .replace(/Fitness Equipment Brand/i, 'Gym Equipment')
      .replace(/Fitness Centre Access/i, 'Gym Access')
      .replace(/Fitness & Wellness/i, 'Gym & Wellness')
      .replace(/Business Centre Operations/i, 'Business Centre')
      .replace(/Business Centre Services/i, 'Business Services')
      .replace(/Halal Certification Status/i, 'Halal Status')
      .replace(/Check-in Method/i, 'Check-in Process')
      .replace(/In-room Dining Availability/i, 'In-Room Dining')
      .replace(/Dining Reservations Email/i, 'Dining Email')
      .replace(/Dining Reservations Phone & WhatsApp/i, 'Dining Phone / WhatsApp')
      .replace(/General Inquiries Email/i, 'General Email')
      .replace(/Main Hotel Telephone/i, 'Hotel Phone')
      .replace(/Official Postal Address/i, 'Address')
      .replace(/Loyalty Programme/i, 'Loyalty Program')
      .replace(/Primary offering/i, 'Primary Services')
      .replace(/Business type/i, 'Business Type')
      .replace(/Method of purchase/i, 'Booking Method')
      .replace(/Communication style/i, 'Brand Voice')
      .replace(/Clients/i, 'Target Clients')
      .trim();

    detail = detail
      .replace(/^HIGH-PRIORITY GROUND TRUTH RULE:\s*/i, '')
      .replace(/^Topic:[^:]+Rule:\s*/i, '')
      .replace(/^CLARIFICATION RESOLVED:\s*/i, '')
      .trim();

    return { topic, detail };
  };

  // Straightforward, concise categorization with dedicated document/venue sections
  const getCategoryForTopic = (item: KnowledgeItem, topic: string, detail: string): string => {
    // 1. If item came from a document or PDF, group by its dedicated Document / Venue title!
    const metaVenue = String(item.metadata?.venue || '').trim();
    const metaDoc = String(item.metadata?.documentName || '').trim();
    const metaFile = String(item.metadata?.fileName || '').trim();

    const rawCombined = `${topic} ${detail} ${metaVenue} ${metaDoc} ${metaFile}`.toLowerCase();

    if (rawCombined.includes('merdeka grill') || rawCombined.includes('merdeka-grill')) {
      return 'Merdeka Grill Menu';
    }
    if (rawCombined.includes('park lounge') || rawCombined.includes('park-lounge')) {
      return 'Park Lounge Menu';
    }
    if (metaVenue) {
      return metaVenue.endsWith('Menu') ? metaVenue : `${metaVenue} Menu`;
    }
    if (metaDoc) {
      return metaDoc;
    }

    const combined = `${topic} ${detail}`.toLowerCase();

    // Check specific granular operational topics first
    if (combined.includes('room') || combined.includes('suite') || combined.includes('bed') || combined.includes('accommodation') || combined.includes('view') || combined.includes('capacity')) {
      return 'Rooms & Suites';
    }
    if (combined.includes('dining') || combined.includes('restaurant') || combined.includes('breakfast') || combined.includes('menu') || combined.includes('cuisine') || combined.includes('dish') || combined.includes('dietary')) {
      return 'Dining & Menus';
    }
    if (combined.includes('amenit') || combined.includes('pool') || combined.includes('spa') || combined.includes('gym') || combined.includes('fitness') || combined.includes('wellness') || combined.includes('recreation')) {
      return 'Amenities & Wellness';
    }
    if (combined.includes('check-in') || combined.includes('check-out') || combined.includes('arrival') || combined.includes('departure') || combined.includes('front desk') || combined.includes('hour') || combined.includes('schedule') || combined.includes('timing')) {
      return 'Check-in & Hours';
    }
    if (combined.includes('parking') || combined.includes('shuttle') || combined.includes('transport') || combined.includes('airport') || combined.includes('valet')) {
      return 'Parking & Transport';
    }
    if (combined.includes('cancel') || combined.includes('refund') || combined.includes('deposit') || combined.includes('price') || combined.includes('rate') || combined.includes('fee') || combined.includes('payment') || combined.includes('cost') || combined.includes('discount')) {
      return 'Pricing & Policies';
    }
    if (combined.includes('client') || combined.includes('customer') || combined.includes('audience') || combined.includes('guest') || combined.includes('business type') || combined.includes('primary offering') || combined.includes('target clients') || combined.includes('primary services')) {
      return 'Business Overview';
    }
    if (combined.includes('tone') || combined.includes('communication') || combined.includes('style') || combined.includes('email') || combined.includes('phone') || combined.includes('contact') || combined.includes('voice')) {
      return 'Contact & Brand Voice';
    }
    if (combined.includes('event') || combined.includes('meeting') || combined.includes('conference') || combined.includes('wedding') || combined.includes('party')) {
      return 'Events & Meetings';
    }

    // Dynamic fallback: Use the topic itself as a clean title if it's descriptive
    if (topic && topic.length >= 4 && !topic.toLowerCase().includes('general') && !topic.toLowerCase().includes('fact')) {
      return topic;
    }

    return 'General Operations';
  };

  // Category Operational Hierarchy: Business Overview -> Rooms -> Dining -> Amenities -> Check-in -> Parking -> Pricing -> Events -> Contact -> Operations
  // Category Operational Hierarchy: Business Overview -> Dedicated Menus -> Rooms -> Dining -> Amenities -> Check-in -> Parking -> Pricing -> Events -> Contact -> Operations
  const CATEGORY_PRIORITY: Record<string, number> = {
    'Business Overview': 100,
    'Merdeka Grill Menu': 92,
    'Park Lounge Menu': 91,
    'Rooms & Suites': 90,
    'Dining & Menus': 85,
    'Amenities & Wellness': 80,
    'Check-in & Hours': 75,
    'Parking & Transport': 70,
    'Pricing & Policies': 65,
    'Events & Meetings': 60,
    'Contact & Brand Voice': 55,
    'General Operations': 40,
  };

  // Calculate granular item priority & relevance score (100 = highest authority/relevance)
  const calculateItemPriority = (item: KnowledgeItem, topic: string, detail: string): number => {
    // 1. Explicit Ground-Truth Rules & User Answers have highest authority
    if (item.source === 'user_teaching' || item.metadata?.isGroundTruth) {
      if (item.metadata?.seedId?.startsWith('onboard-')) return 100;
      return 95;
    }

    // 2. High-frequency customer inquiry facts (timing, prices, core capacity)
    const lowerTopic = `${topic} ${detail}`.toLowerCase();
    if (lowerTopic.includes('check-in') || lowerTopic.includes('check-out') || lowerTopic.includes('hours') || lowerTopic.includes('time')) {
      return 88;
    }
    if (lowerTopic.includes('breakfast') || lowerTopic.includes('cuisine') || lowerTopic.includes('dining')) {
      return 86;
    }
    if (lowerTopic.includes('parking') || lowerTopic.includes('shuttle') || lowerTopic.includes('transfer')) {
      return 84;
    }
    if (lowerTopic.includes('suite') || lowerTopic.includes('room') || lowerTopic.includes('capacity') || lowerTopic.includes('bed')) {
      return 82;
    }
    if (lowerTopic.includes('fee') || lowerTopic.includes('rate') || lowerTopic.includes('cancellation') || lowerTopic.includes('deposit')) {
      return 80;
    }
    if (lowerTopic.includes('pool') || lowerTopic.includes('gym') || lowerTopic.includes('fitness') || lowerTopic.includes('spa')) {
      return 78;
    }

    // 3. General operational & architectural details
    if (item.source === 'pdf') {
      return 70;
    }

    return 60;
  };

  // Check if an item was added or updated within the last 10 minutes (600,000ms)
  const isRecentNewItem = (item: KnowledgeItem): boolean => {
    // Check item timestamp or explicit taught/created timestamp
    const rawTime = item.metadata?.taughtAt || item.metadata?.createdAt || item.timestamp;
    if (!rawTime) return false;
    const itemDate = new Date(rawTime).getTime();
    if (isNaN(itemDate)) return false;
    const ageMs = Date.now() - itemDate;
    return ageMs >= 0 && ageMs < 10 * 60 * 1000;
  };

  // Separate recent items (<10 mins old) to display at the top of the knowledge page
  const recentItems = items.filter(isRecentNewItem);
  const standardItems = items.filter(item => !isRecentNewItem(item));

  // Group standard items by category and sort them hierarchically
  const groupedRules = standardItems.reduce((acc, item) => {
    const { topic, detail } = parseKnowledgeRow(item);
    const category = getCategoryForTopic(item, topic, detail);
    if (!acc[category]) acc[category] = [];
    acc[category].push(item);
    return acc;
  }, {} as Record<string, KnowledgeItem[]>);

  // Sort items within each category by priority score descending (highest priority first)
  Object.keys(groupedRules).forEach(category => {
    groupedRules[category].sort((a, b) => {
      const parsedA = parseKnowledgeRow(a);
      const parsedB = parseKnowledgeRow(b);
      const scoreA = calculateItemPriority(a, parsedA.topic, parsedA.detail);
      const scoreB = calculateItemPriority(b, parsedB.topic, parsedB.detail);
      return scoreB - scoreA;
    });
  });

  // Sort categories by operational importance
  const sortedCategories = Object.entries(groupedRules).sort(([catA], [catB]) => {
    const prioA = CATEGORY_PRIORITY[catA] || 50;
    const prioB = CATEGORY_PRIORITY[catB] || 50;
    return prioB - pririoA(catA, catB, prioA, prioB);
  });

  function pririoA(catA: string, catB: string, prioA: number, prioB: number) {
    if (prioB !== prioA) return prioA;
    return catA.localeCompare(catB);
  }

  return (
    <div className="flex h-screen bg-white overflow-hidden text-[#1D1D1F]">
      {/* Hidden input for uploading text/pdf documents */}
      <input
        type="file"
        ref={fileInputRef}
        onChange={handleFileUpload}
        accept=".pdf,.txt,.docx"
        className="hidden"
      />

      <Sidebar onCompose={() => setIsComposeOpen(true)} />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        {isComposeOpen ? (
          <ComposeModal isOpen={isComposeOpen} onClose={() => setIsComposeOpen(false)} />
        ) : (
          <div className="flex-1 overflow-y-auto w-full p-4 sm:p-6 lg:p-7 space-y-6">
            {/* Status Message Pill */}
            {statusMessage && (
              <div className="flex items-center">
                <span className="text-xs text-emerald-700 bg-emerald-50 px-3 py-1.5 rounded-full border border-emerald-200/60 font-medium">
                  {statusMessage}
                </span>
              </div>
            )}

            {isLoading ? (
              <div className="w-full py-16 flex flex-col items-center justify-center space-y-3 opacity-40">
                <RefreshCw className="w-5 h-5 text-gray-400 animate-spin" />
                <p className="text-xs text-gray-400 font-medium">Loading knowledge rules...</p>
              </div>
            ) : items.length === 0 ? (
              <div className="w-full py-16 text-center text-sm text-gray-500 bg-white rounded-2xl border border-black/5 p-8 space-y-4">
                <BookOpen className="w-10 h-10 text-gray-300 mx-auto" />
                <h3 className="text-sm font-semibold text-gray-800">No saved knowledge yet</h3>
                <p className="text-xs text-gray-500 max-w-sm mx-auto">
                  Answer questions in Clarifications or upload documents to build your business memory.
                </p>
                <div className="flex items-center justify-center gap-2.5 pt-2">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    disabled={isUploading}
                    className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl border border-black/10 bg-white hover:bg-gray-50 text-gray-800 transition-all cursor-pointer disabled:opacity-50 text-xs font-semibold"
                  >
                    <Upload className={`w-3.5 h-3.5 ${isUploading ? 'animate-spin text-[#FF751F]' : ''}`} />
                    <span>{isUploading ? 'Uploading...' : 'Upload Document'}</span>
                  </button>
                </div>
              </div>
            ) : (
              <div className="w-full space-y-6">
                {/* 1. Dedicated Top Section: Newly Added Knowledge (< 10 minutes old) from ANY source */}
                {recentItems.length > 0 && (
                  <div className="w-full space-y-1">
                    <div className="flex items-center justify-between pb-0.5">
                      <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                        <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900 flex items-center gap-1.5">
                          <span>Newly Added Knowledge</span>
                        </h3>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                          {recentItems.length}
                        </span>
                      </div>
                    </div>

                    {/* Clean flat outer border container wrapping items of this section - exact same as other sections */}
                    <div className="w-full rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none">
                      <div className="divide-y divide-gray-100 px-4 sm:px-6">
                        {recentItems.map(item => {
                          const { topic, detail } = parseKnowledgeRow(item);
                          const isEditing = editingId === item.id;

                          // Resolve source document / channel
                          const fileName = item.metadata?.fileName || item.metadata?.documentName;
                          const assetId = item.metadata?.assetId;
                          const matchedAsset = assets.find(a => (assetId && a.id === assetId) || (fileName && a.name.toLowerCase().includes(String(fileName).toLowerCase())));
                          const displayDocName = matchedAsset?.name || fileName;
                          const downloadUrl = matchedAsset ? `/api/assets/raw?id=${matchedAsset.id}` : '#';

                          return (
                            <div
                              key={item.id}
                              className="w-full py-3 sm:py-3.5 group"
                            >
                              {isEditing ? (
                                <div className="w-full space-y-2.5 bg-gray-50/60 p-3.5 rounded-xl border border-gray-200/80">
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                      Topic / Rule Name
                                    </label>
                                    <input
                                      type="text"
                                      value={editTitle}
                                      onChange={e => setEditTitle(e.target.value)}
                                      className="w-full rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-900 outline-none focus:border-[#FF751F]"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                      Detail / Confirmed Fact
                                    </label>
                                    <textarea
                                      value={editText}
                                      onChange={e => setEditText(e.target.value)}
                                      rows={2}
                                      className="w-full rounded-lg bg-white border border-gray-200 p-2.5 text-xs text-gray-900 outline-none focus:border-[#FF751F] resize-none leading-relaxed"
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-white transition cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(item.id)}
                                      className="px-3.5 py-1.5 rounded-lg bg-[#FF751F] hover:bg-[#E6650F] text-xs font-semibold text-white transition cursor-pointer"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                                  {/* Column 1: Topic */}
                                  <div className="sm:col-span-3 pr-2">
                                    <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                                      {topic}
                                    </span>
                                  </div>

                                  {/* Column 2: Detail */}
                                  <div className="sm:col-span-5 pr-2">
                                    <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                                      {detail}
                                    </p>
                                  </div>

                                  {/* Column 3: Source */}
                                  <div className="sm:col-span-3 flex items-center">
                                    {displayDocName ? (
                                      <a
                                        href={downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200/80 border-none text-gray-700 hover:text-gray-900 text-[11px] font-medium transition-all max-w-full group/pill shadow-none"
                                        title={`View source document: ${displayDocName}`}
                                      >
                                        <FileText className="w-3 h-3 text-gray-400 group-hover/pill:text-gray-600 shrink-0" />
                                        <span className="truncate max-w-[170px]">{displayDocName}</span>
                                        <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover/pill:opacity-100 shrink-0" />
                                      </a>
                                    ) : (() => {
                                      const meta = item.metadata || {};
                                      const isVoice = meta.origin === 'voice_teaching' || 
                                        meta.origin === 'voice_session_closing' || 
                                        meta.sourceType === 'voice' || 
                                        item.id.startsWith('voice_') ||
                                        (typeof meta.taughtAt === 'string' && meta.origin?.includes('voice'));

                                      const isClarification = Boolean(
                                        meta.resolvedQuestion || 
                                        meta.seedId || 
                                        meta.question || 
                                        item.source === 'clarification' ||
                                        meta.source === 'clarification'
                                      );

                                      const isEmail = item.source === 'gmail' || 
                                        Boolean(meta.threadId || meta.emailId || meta.type === 'writing_style');

                                      if (isVoice) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <Mic className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Voice Training</span>
                                          </span>
                                        );
                                      }

                                      if (isClarification) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <HelpCircle className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Clarifications</span>
                                          </span>
                                        );
                                      }

                                      if (isEmail) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <Mail className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Email Learning</span>
                                          </span>
                                        );
                                      }

                                      return (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                          <span>Direct Entry</span>
                                        </span>
                                      );
                                    })()}
                                  </div>

                                  {/* Column 4: Action */}
                                  <div className="sm:col-span-1 flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEdit(item, topic, detail)}
                                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition cursor-pointer"
                                      title="Edit rule"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteItem(item.id)}
                                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition cursor-pointer"
                                      title="Delete rule"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
                {sortedCategories.map(([sectionTitle, sectionItems], sectionIndex) => (
                  <div key={sectionTitle} className="w-full space-y-1">
                    {/* Category Section Header matching Clarifications */}
                    <div className="flex items-center justify-between pb-0.5">
                      <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                        <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                          {sectionTitle}
                        </h3>
                        <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                          {sectionItems.length}
                        </span>
                      </div>

                      {/* Header Actions next to the first section header row */}
                      {sectionIndex === 0 && (
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => fileInputRef.current?.click()}
                            disabled={isUploading}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-black/10 bg-white hover:bg-gray-50 text-gray-700 hover:text-black transition-colors cursor-pointer disabled:opacity-50 text-xs font-semibold"
                            title="Upload PDF or text document to index into AI memory"
                          >
                            <Upload className={`w-3.5 h-3.5 ${isUploading ? 'animate-spin text-[#FF751F]' : ''}`} />
                            <span>{isUploading ? 'Uploading...' : 'Upload Document'}</span>
                          </button>

                          <button
                            type="button"
                            onClick={handleClearAllKnowledge}
                            disabled={isClearing}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-red-200/80 bg-white hover:bg-red-50 text-red-600 transition-colors cursor-pointer disabled:opacity-50 text-xs font-semibold"
                            title="Clear all knowledge rules"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            <span>{isClearing ? 'Clearing...' : 'Clear All'}</span>
                          </button>
                        </div>
                      )}
                    </div>

                    {/* Clean flat outer border container wrapping items of this section */}
                    <div className="w-full rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none">

                      <div className="divide-y divide-gray-100 px-4 sm:px-6">
                        {sectionItems.map(item => {
                          const { topic, detail } = parseKnowledgeRow(item);
                          const isEditing = editingId === item.id;

                          // Resolve source document / channel
                          const fileName = item.metadata?.fileName || item.metadata?.documentName;
                          const assetId = item.metadata?.assetId;
                          const matchedAsset = assets.find(a => (assetId && a.id === assetId) || (fileName && a.name.toLowerCase().includes(String(fileName).toLowerCase())));
                          const displayDocName = matchedAsset?.name || fileName;
                          const downloadUrl = matchedAsset ? `/api/assets/raw?id=${matchedAsset.id}` : '#';

                          return (
                            <div
                              key={item.id}
                              className="w-full py-3 sm:py-3.5 group"
                            >
                              {isEditing ? (
                                <div className="w-full space-y-2.5 bg-gray-50/60 p-3.5 rounded-xl border border-gray-200/80">
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                      Topic / Rule Name
                                    </label>
                                    <input
                                      type="text"
                                      value={editTitle}
                                      onChange={e => setEditTitle(e.target.value)}
                                      className="w-full rounded-lg bg-white border border-gray-200 px-3 py-1.5 text-xs font-semibold text-gray-900 outline-none focus:border-[#FF751F]"
                                    />
                                  </div>
                                  <div>
                                    <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-1">
                                      Detail / Confirmed Fact
                                    </label>
                                    <textarea
                                      value={editText}
                                      onChange={e => setEditText(e.target.value)}
                                      rows={2}
                                      className="w-full rounded-lg bg-white border border-gray-200 p-2.5 text-xs text-gray-900 outline-none focus:border-[#FF751F] resize-none leading-relaxed"
                                    />
                                  </div>
                                  <div className="flex justify-end gap-2 pt-1">
                                    <button
                                      type="button"
                                      onClick={() => setEditingId(null)}
                                      className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs font-medium text-gray-600 hover:bg-white transition cursor-pointer"
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleSaveEdit(item.id)}
                                      className="px-3.5 py-1.5 rounded-lg bg-[#FF751F] hover:bg-[#E6650F] text-xs font-semibold text-white transition cursor-pointer"
                                    >
                                      Save
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                                  {/* Column 1: Topic */}
                                  <div className="sm:col-span-3 pr-2">
                                    <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                                      {topic}
                                    </span>
                                  </div>

                                  {/* Column 2: Detail */}
                                  <div className="sm:col-span-5 pr-2">
                                    <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                                      {detail}
                                    </p>
                                  </div>

                                  {/* Column 3: Source */}
                                  <div className="sm:col-span-3 flex items-center">
                                    {displayDocName ? (
                                      <a
                                        href={downloadUrl}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-gray-100 hover:bg-gray-200/80 border-none text-gray-700 hover:text-gray-900 text-[11px] font-medium transition-all max-w-full group/pill shadow-none"
                                        title={`View source document: ${displayDocName}`}
                                      >
                                        <FileText className="w-3 h-3 text-gray-400 group-hover/pill:text-gray-600 shrink-0" />
                                        <span className="truncate max-w-[170px]">{displayDocName}</span>
                                        <ExternalLink className="w-2.5 h-2.5 opacity-50 group-hover/pill:opacity-100 shrink-0" />
                                      </a>
                                    ) : (() => {
                                      const meta = item.metadata || {};
                                      const isVoice = meta.origin === 'voice_teaching' || 
                                        meta.origin === 'voice_session_closing' || 
                                        meta.sourceType === 'voice' || 
                                        item.id.startsWith('voice_') ||
                                        (typeof meta.taughtAt === 'string' && meta.origin?.includes('voice'));

                                      const isClarification = Boolean(
                                        meta.resolvedQuestion || 
                                        meta.seedId || 
                                        meta.question || 
                                        item.source === 'clarification' ||
                                        meta.source === 'clarification'
                                      );

                                      const isEmail = item.source === 'gmail' || 
                                        Boolean(meta.threadId || meta.emailId || meta.type === 'writing_style');

                                      if (isVoice) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <Mic className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Voice Training</span>
                                          </span>
                                        );
                                      }

                                      if (isClarification) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <HelpCircle className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Clarifications</span>
                                          </span>
                                        );
                                      }

                                      if (isEmail) {
                                        return (
                                          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                            <Mail className="w-3 h-3 text-gray-500 shrink-0" />
                                            <span>Email Learning</span>
                                          </span>
                                        );
                                      }

                                      return (
                                        <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-gray-700 bg-gray-100/90 hover:bg-gray-200/80 transition-colors px-2.5 py-1 rounded-md border-none shadow-none cursor-default">
                                          <span>Direct Entry</span>
                                        </span>
                                      );
                                    })()}
                                  </div>

                                  {/* Column 4: Action */}
                                  <div className="sm:col-span-1 flex items-center justify-end gap-1 sm:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                      type="button"
                                      onClick={() => handleStartEdit(item, topic, detail)}
                                      className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition cursor-pointer"
                                      title="Edit rule"
                                    >
                                      <Edit3 className="w-3.5 h-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => handleDeleteItem(item.id)}
                                      className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition cursor-pointer"
                                      title="Delete rule"
                                    >
                                      <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
