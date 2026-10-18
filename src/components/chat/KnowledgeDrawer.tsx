'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  FileText,
  Image as ImageIcon,
  Sparkles,
  Trash2,
  ExternalLink,
  BookOpen,
  Search,
  RefreshCw,
  Clock,
  Layers,
  ChevronRight,
  Eye,
  Check,
  Edit2
} from 'lucide-react';

export interface KnowledgeItem {
  id: string;
  text: string;
  source: string;
  title: string;
  timestamp: string;
  metadata?: any;
}

export interface BusinessAsset {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  size: number;
  uploadedAt: string;
  description?: string;
  purpose?: string;
  whenToShare?: string;
  relevantTopics?: string[];
  extractedFactsCount?: number;
}

interface KnowledgeDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onItemCountChange?: (factsCount: number, assetsCount: number) => void;
  refreshTrigger?: number;
}

export default function KnowledgeDrawer({
  isOpen,
  onClose,
  onItemCountChange,
  refreshTrigger = 0,
}: KnowledgeDrawerProps) {
  const [activeTab, setActiveTab] = useState<'facts' | 'media'>('facts');
  const [facts, setFacts] = useState<KnowledgeItem[]>([]);
  const [assets, setAssets] = useState<BusinessAsset[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [previewMedia, setPreviewMedia] = useState<BusinessAsset | null>(null);
  const [editingAsset, setEditingAsset] = useState<BusinessAsset | null>(null);
  const [editPurpose, setEditPurpose] = useState('');
  const [editWhenToShare, setEditWhenToShare] = useState('');

  const loadData = async () => {
    setLoading(true);
    try {
      const [knowRes, assetRes] = await Promise.all([
        fetch('/api/knowledge'),
        fetch('/api/assets'),
      ]);
      const knowData = await knowRes.json();
      const assetData = await assetRes.json();

      const loadedFacts = knowData.success ? knowData.items || [] : [];
      const loadedAssets = assetData.success ? assetData.assets || [] : [];

      setFacts(loadedFacts);
      setAssets(loadedAssets);

      if (onItemCountChange) {
        onItemCountChange(loadedFacts.length, loadedAssets.length);
      }
    } catch (err) {
      console.error('Error fetching knowledge drawer data:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [refreshTrigger]);

  const handleDeleteFact = async (id: string) => {
    // Instant deletion without blocking confirmation popup
    setFacts(prev => prev.filter(f => f.id !== id));
    try {
      await fetch(`/api/knowledge?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete fact:', err);
    }
  };

  const handleDeleteAsset = async (id: string) => {
    // Instant deletion without blocking confirmation popup
    setAssets(prev => prev.filter(a => a.id !== id));
    try {
      await fetch(`/api/assets?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (err) {
      console.error('Failed to delete asset:', err);
    }
  };

  const handleSaveAssetEdits = async () => {
    if (!editingAsset) return;
    try {
      const res = await fetch('/api/assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: editingAsset.id,
          purpose: editPurpose,
          whenToShare: editWhenToShare,
        }),
      });
      const data = await res.json();
      if (data.success && data.asset) {
        setAssets(prev => prev.map(a => (a.id === editingAsset.id ? data.asset : a)));
        setEditingAsset(null);
      }
    } catch (err) {
      console.error('Failed to update asset metadata:', err);
    }
  };

  const filteredFacts = facts.filter(f =>
    f.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    f.text.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredAssets = assets.filter(a =>
    a.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.description || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.purpose || '').toLowerCase().includes(searchQuery.toLowerCase()) ||
    (a.whenToShare || '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 w-full max-w-md bg-white border-l border-[#E5E5E7] shadow-2xl flex flex-col font-sans animate-in slide-in-from-right duration-200">
      {/* Drawer Header */}
      <div className="p-4 border-b border-[#E5E5E7] flex items-center justify-between bg-white shrink-0">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FF751F] border border-orange-200/80 flex items-center justify-center">
            <Layers className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900 tracking-tight">Live Knowledge Hub</h3>
            <p className="text-[11px] text-gray-500">Real-time indexed facts & customer media</p>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={loadData}
            title="Refresh"
            disabled={loading}
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={onClose}
            title="Close Drawer"
            className="p-1.5 text-gray-400 hover:text-gray-700 hover:bg-gray-100 rounded-lg transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 pt-3 pb-2 border-b border-[#E5E5E7] bg-[#FAFAFA] flex items-center gap-2 shrink-0">
        <button
          onClick={() => setActiveTab('facts')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'facts'
              ? 'bg-white text-gray-900 shadow-2xs border border-black/5 font-semibold'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <Sparkles className="w-3.5 h-3.5 text-[#FF751F]" />
          <span>Operational Facts</span>
          <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded-full font-semibold">
            {facts.length}
          </span>
        </button>

        <button
          onClick={() => setActiveTab('media')}
          className={`flex-1 py-1.5 px-3 rounded-lg text-xs font-medium transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
            activeTab === 'media'
              ? 'bg-white text-gray-900 shadow-2xs border border-black/5 font-semibold'
              : 'text-gray-500 hover:text-gray-900'
          }`}
        >
          <FileText className="w-3.5 h-3.5 text-blue-500" />
          <span>Media & Collateral</span>
          <span className="text-[10px] bg-gray-100 text-gray-600 px-1.5 py-0.2 rounded-full font-semibold">
            {assets.length}
          </span>
        </button>
      </div>

      {/* Search Bar */}
      <div className="p-3 border-b border-[#E5E5E7] bg-white shrink-0">
        <div className="relative">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <input
            type="text"
            placeholder={activeTab === 'facts' ? 'Filter facts...' : 'Filter media & collateral...'}
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full h-8 pl-8 pr-3 text-xs rounded-lg bg-gray-50 border border-gray-200 outline-none focus:bg-white focus:border-[#FF751F] transition-all"
          />
        </div>
      </div>

      {/* Content Area */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {loading && facts.length === 0 && assets.length === 0 ? (
          <div className="py-12 text-center text-xs text-gray-400">Loading verified knowledge...</div>
        ) : activeTab === 'facts' ? (
          /* FACTS LIST */
          filteredFacts.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              No facts match your filter. Teach new facts in the chat!
            </div>
          ) : (
            filteredFacts.map(fact => (
              <div
                key={fact.id}
                className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 bg-white shadow-2xs transition-all space-y-1.5 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-[11px] font-semibold text-gray-900 uppercase tracking-tight">
                      {fact.title}
                    </span>
                    <span className="text-[9.5px] px-1.5 py-0.5 rounded-md bg-orange-50 text-[#FF751F] border border-orange-200/60 font-medium">
                      {fact.source === 'user_teaching' ? 'Taught in Chat' : fact.source}
                    </span>
                  </div>
                  <button
                    onClick={() => handleDeleteFact(fact.id)}
                    title="Remove from memory"
                    className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 transition-opacity cursor-pointer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </button>
                </div>
                <p className="text-[13px] text-gray-700 leading-snug">
                  {fact.text.replace(/^[^:]+:\s*/, '')}
                </p>
                <div className="text-[10px] text-gray-400 pt-1 flex items-center gap-1">
                  <Clock className="w-3 h-3" />
                  <span>
                    {fact.timestamp ? new Date(fact.timestamp).toLocaleDateString() : 'Active'}
                  </span>
                </div>
              </div>
            ))
          )
        ) : (
          /* MEDIA & ASSETS LIST */
          filteredAssets.length === 0 ? (
            <div className="py-12 text-center text-xs text-gray-400">
              No media or PDFs uploaded yet. Attach documents or images in the chat!
            </div>
          ) : (
            filteredAssets.map(asset => (
              <div
                key={asset.id}
                className="p-3 rounded-xl border border-gray-100 hover:border-gray-200 bg-white shadow-2xs transition-all space-y-2 group"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-lg bg-blue-50 text-blue-600 border border-blue-100 flex items-center justify-center shrink-0">
                      {asset.mimeType.startsWith('image/') ? (
                        <ImageIcon className="w-4 h-4" />
                      ) : (
                        <FileText className="w-4 h-4" />
                      )}
                    </div>
                    <div className="min-w-0">
                      <p className="text-xs font-semibold text-gray-900 truncate max-w-[200px]" title={asset.name}>
                        {asset.name}
                      </p>
                      <span className="text-[10px] text-gray-400">
                        {(asset.size / 1024).toFixed(0)} KB •{' '}
                        {asset.mimeType.startsWith('image/') ? 'Image Asset' : 'PDF Document'}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center gap-1">
                    <button
                      onClick={() => {
                        setEditingAsset(asset);
                        setEditPurpose(asset.purpose || asset.description || '');
                        setEditWhenToShare(asset.whenToShare || '');
                      }}
                      title="Edit Purpose & Trigger"
                      className="p-1 text-gray-400 hover:text-gray-700 rounded transition-colors cursor-pointer"
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDeleteAsset(asset.id)}
                      title="Delete Asset"
                      className="opacity-0 group-hover:opacity-100 text-gray-400 hover:text-red-500 p-1 transition-opacity cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Purpose & Share Trigger */}
                <div className="p-2 rounded-lg bg-gray-50 border border-black/5 text-[11.5px] space-y-1">
                  <div>
                    <span className="font-semibold text-gray-700">What it is: </span>
                    <span className="text-gray-600">{asset.purpose || asset.description || 'General collateral'}</span>
                  </div>
                  <div>
                    <span className="font-semibold text-emerald-700">When AI shares it: </span>
                    <span className="text-gray-600">{asset.whenToShare || 'When customer requests it'}</span>
                  </div>
                </div>

                {/* Actions & Preview link */}
                <div className="flex items-center justify-between pt-1">
                  {asset.extractedFactsCount !== undefined && asset.extractedFactsCount > 0 && (
                    <span className="text-[10px] text-[#FF751F] font-medium flex items-center gap-1">
                      <Sparkles className="w-3 h-3" />
                      {asset.extractedFactsCount} facts indexed to memory
                    </span>
                  )}
                  <a
                    href={`/api/assets/file?id=${encodeURIComponent(asset.id)}`}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 text-[11px] font-medium text-blue-600 hover:text-blue-800 ml-auto"
                  >
                    <span>View File</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>
                </div>
              </div>
            ))
          )
        )}
      </div>

      {/* Edit Purpose & Trigger Modal */}
      {editingAsset && (
        <div className="fixed inset-0 z-60 bg-black/40 backdrop-blur-xs flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl max-w-sm w-full p-5 space-y-4 shadow-xl border border-black/10 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between">
              <h4 className="text-sm font-semibold text-gray-900">Edit Collateral Triggers</h4>
              <button
                onClick={() => setEditingAsset(null)}
                className="text-gray-400 hover:text-gray-600 p-1"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="text-[11px] font-semibold text-gray-700 block mb-1">
                  What is this file? (Purpose)
                </label>
                <input
                  type="text"
                  value={editPurpose}
                  onChange={e => setEditPurpose(e.target.value)}
                  className="w-full h-8 px-3 text-xs rounded-lg bg-gray-50 border border-gray-200 outline-none focus:bg-white focus:border-[#FF751F]"
                />
              </div>

              <div>
                <label className="text-[11px] font-semibold text-gray-700 block mb-1">
                  When should the AI share this with customers?
                </label>
                <textarea
                  value={editWhenToShare}
                  onChange={e => setEditWhenToShare(e.target.value)}
                  rows={3}
                  className="w-full p-2 text-xs rounded-lg bg-gray-50 border border-gray-200 outline-none focus:bg-white focus:border-[#FF751F] resize-none"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                type="button"
                onClick={() => setEditingAsset(null)}
                className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-600 hover:bg-gray-100 transition-colors"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleSaveAssetEdits}
                className="px-3.5 py-1.5 rounded-lg text-xs font-semibold bg-[#FF751F] hover:bg-[#e06518] text-white transition-colors cursor-pointer"
              >
                Save Changes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
