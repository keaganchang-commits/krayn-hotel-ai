'use client';

import React, { useState, useRef, useEffect, Suspense } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Sidebar from '@/components/Sidebar';
import KnowledgeDrawer from '@/components/chat/KnowledgeDrawer';
import {
  ArrowUp,
  Sparkles,
  HelpCircle,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
  User,
  Bot,
  Paperclip,
  FileText,
  Image as ImageIcon,
  Check,
  X,
  Layers,
  ChevronRight,
  ExternalLink,
  Loader2,
  Send,
  MessageSquare,
  GraduationCap,
  Mic,
  Volume2,
  Mail,
  Calendar,
  ShieldCheck,
  RotateCcw,
  CheckCheck
} from 'lucide-react';
import Link from 'next/link';
import VoiceTeachModal from '@/components/chat/VoiceTeachModal';

interface Citation {
  source: 'gmail' | 'pdf' | 'user_teaching' | 'clarification' | 'image';
  title: string;
  snippet: string;
  score: number;
}

interface AttachedAsset {
  id: string;
  name: string;
  filename: string;
  mimeType: string;
  size?: number;
  url?: string;
  description?: string;
  purpose?: string;
}

interface VerificationCardData {
  assetId: string;
  filename: string;
  originalName: string;
  mimeType: string;
  detectedType: string;
  detectedPurpose: string;
  detectedWhenToShare: string;
  extractedFactsCount: number;
  isConfirmed?: boolean;
}

interface Message {
  id: string;
  sender: 'user' | 'ai';
  text: string;
  timestamp: string;
  mode?: 'teach' | 'test';
  channel?: 'whatsapp' | 'email';
  status?: 'answered' | 'irrelevant' | 'unanswered';
  citations?: Citation[];
  attachedAssets?: AttachedAsset[];
  confidenceScore?: number;
  queuedToClarifications?: boolean;
  clarificationQuestion?: string;
  actionExecuted?: string;
  subject?: string;
  mediaUrl?: string;
  mediaFilename?: string;
  // Teaching specific metadata
  teachingVerification?: VerificationCardData;
  taughtFacts?: Array<{ topic: string; detail: string }>;
  isTeachingSuccess?: boolean;
}

function ChatContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const initialQuery = searchParams.get('query') || '';
  const initialMode = searchParams.get('mode') === 'test' ? 'test' : 'teach';
  const initialChannel = (searchParams.get('channel') === 'email' ? 'email' : 'whatsapp') as 'whatsapp' | 'email';

  // Mode switcher: 'teach' (train knowledge) vs 'test' (test as a customer)
  const [activeMode, setActiveMode] = useState<'teach' | 'test'>(initialMode);
  // Channel switcher for test mode: 'whatsapp' vs 'email'
  const [activeChannel, setActiveChannel] = useState<'whatsapp' | 'email'>(initialChannel);

  // Email simulation header fields
  const [simSenderName, setSimSenderName] = useState('Sarah Jenkins');
  const [simSenderEmail, setSimSenderEmail] = useState('sarah.jenkins@example.com');
  const [simSubject, setSimSubject] = useState('Inquiry regarding Park Hyatt Kuala Lumpur');

  useEffect(() => {
    const modeParam = searchParams.get('mode');
    if (modeParam === 'test' || modeParam === 'teach') {
      setActiveMode(modeParam);
    }
    const channelParam = searchParams.get('channel');
    if (channelParam === 'email' || channelParam === 'whatsapp') {
      setActiveChannel(channelParam);
    }
    if (searchParams.get('voice') === '1') {
      setIsVoiceModalOpen(true);
    }
  }, [searchParams]);

  // Live Knowledge Drawer state
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isVoiceModalOpen, setIsVoiceModalOpen] = useState(false);
  const [factsCount, setFactsCount] = useState<number>(0);
  const [assetsCount, setAssetsCount] = useState<number>(0);
  const [drawerRefreshTrigger, setDrawerRefreshTrigger] = useState<number>(0);

  // File upload staging state (teach mode)
  const [stagedFile, setStagedFile] = useState<File | null>(null);
  const [filePreviewUrl, setFilePreviewUrl] = useState<string | null>(null);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Separate conversation threads per channel/mode
  const [teachMessages, setTeachMessages] = useState<Message[]>([
    {
      id: 'welcome_teach',
      sender: 'ai',
      mode: 'teach',
      text: "You can teach me rules, policies, or attach files like menus and brochures. I'll learn them and use them to answer customers.",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'answered',
    },
  ]);

  const [whatsappMessages, setWhatsappMessages] = useState<Message[]>([
    {
      id: 'welcome_wa',
      sender: 'ai',
      mode: 'test',
      channel: 'whatsapp',
      text: "Hello! Welcome to Park Hyatt Kuala Lumpur. How can I help you?",
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'answered',
      actionExecuted: 'Official WhatsApp Concierge connected',
      confidenceScore: 100,
    },
  ]);

  const [emailMessages, setEmailMessages] = useState<Message[]>([
    {
      id: 'welcome_email',
      sender: 'ai',
      mode: 'test',
      channel: 'email',
      subject: 'Welcome to Park Hyatt Kuala Lumpur Guest Relations',
      text: `Dear Guest,\n\nWelcome to Park Hyatt Kuala Lumpur. How can I help you?\n\nWarm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`,
      timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
      status: 'answered',
      actionExecuted: 'Official Guest Relations connected',
      confidenceScore: 100,
    },
  ]);

  const currentMessages = activeMode === 'teach'
    ? teachMessages
    : activeChannel === 'whatsapp'
      ? whatsappMessages
      : emailMessages;

  const setCurrentMessages = (updater: (prev: Message[]) => Message[]) => {
    if (activeMode === 'teach') {
      setTeachMessages(updater);
    } else if (activeChannel === 'whatsapp') {
      setWhatsappMessages(updater);
    } else {
      setEmailMessages(updater);
    }
  };

  const [inputQuery, setInputQuery] = useState(initialQuery);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentMessages, isLoading]);

  // Load initial knowledge count for header badge
  useEffect(() => {
    Promise.all([
      fetch('/api/knowledge').then(r => r.json()).catch(() => ({})),
      fetch('/api/assets').then(r => r.json()).catch(() => ({})),
    ]).then(([kData, aData]) => {
      if (kData.success && Array.isArray(kData.items)) setFactsCount(kData.items.length);
      if (aData.success && Array.isArray(aData.assets)) setAssetsCount(aData.assets.length);
    });
  }, [drawerRefreshTrigger]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setStagedFile(file);
    if (file.type.startsWith('image/')) {
      const url = URL.createObjectURL(file);
      setFilePreviewUrl(url);
    } else {
      setFilePreviewUrl(null);
    }
  };

  const removeStagedFile = () => {
    setStagedFile(null);
    if (filePreviewUrl) {
      URL.revokeObjectURL(filePreviewUrl);
      setFilePreviewUrl(null);
    }
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // SEND MESSAGE HANDLER
  const handleSendMessage = async (queryText?: string) => {
    const textToSend = (queryText !== undefined ? queryText : inputQuery).trim();
    if ((!textToSend && !stagedFile) || isLoading) return;

    const currentStagedFile = stagedFile;
    const currentPreviewUrl = filePreviewUrl;

    // Reset input states
    setInputQuery('');
    removeStagedFile();

    const timestamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // USER MESSAGE
    const userMsg: Message = {
      id: `usr_${Date.now()}`,
      sender: 'user',
      mode: activeMode,
      channel: activeMode === 'test' ? activeChannel : undefined,
      subject: activeMode === 'test' && activeChannel === 'email' ? simSubject : undefined,
      text: textToSend || (currentStagedFile ? `Uploaded attachment: ${currentStagedFile.name}` : ''),
      timestamp,
    };

    setCurrentMessages(prev => [...prev, userMsg]);
    setIsLoading(true);

    try {
      // 1. TEACH MODE: FILE UPLOAD
      if (activeMode === 'teach' && currentStagedFile) {
        setIsUploadingFile(true);
        const formData = new FormData();
        formData.append('file', currentStagedFile);
        if (textToSend) formData.append('description', textToSend);

        const res = await fetch('/api/assets', {
          method: 'POST',
          body: formData,
        });
        const data = await res.json();

        if (data.success && data.asset) {
          const asset = data.asset;
          const detectedPurpose = asset.purpose || asset.description || 'Business informational document';
          const detectedWhenToShare = asset.whenToShare || `Attach when customers inquire about ${asset.name.replace(/\.[^/.]+$/, '')}`;
          const factsCountExtracted = data.factsExtracted || 0;

          const aiVerificationMsg: Message = {
            id: `ai_${Date.now()}`,
            sender: 'ai',
            mode: 'teach',
            text: `I've analyzed **${asset.name}** and indexed ${factsCountExtracted > 0 ? `${factsCountExtracted} operational facts` : 'the material'} into memory.\n\nPlease verify how I should identify and share this with customers:`,
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            teachingVerification: {
              assetId: asset.id,
              filename: asset.filename,
              originalName: asset.name,
              mimeType: asset.mimeType,
              detectedType: asset.description || 'Business Document',
              detectedPurpose,
              detectedWhenToShare,
              extractedFactsCount: factsCountExtracted,
              isConfirmed: false,
            },
          };

          setCurrentMessages(prev => [...prev, aiVerificationMsg]);
          setDrawerRefreshTrigger(prev => prev + 1);
          setStatusMessage(`Uploaded & analyzed "${asset.name}" in real-time.`);
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          setCurrentMessages(prev => [
            ...prev,
            {
              id: `ai_${Date.now()}`,
              sender: 'ai',
              mode: 'teach',
              text: data.error || 'Failed to analyze and upload file.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
              status: 'irrelevant',
            },
          ]);
        }
        setIsUploadingFile(false);
        setIsLoading(false);
        return;
      }

      // 2. TEACH MODE: TEXT RULE / FACT
      if (activeMode === 'teach') {
        const res = await fetch('/api/teach', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ rule: textToSend }),
        });
        const data = await res.json();

        if (data.success) {
          const facts = data.extractedFacts || [];
          const aiMsg: Message = {
            id: `ai_${Date.now()}`,
            sender: 'ai',
            mode: 'teach',
            text: facts.length > 0
              ? `Got it. Saved ${facts.map((f: any) => f.topic).join(', ')}.`
              : 'Got it. Saved to knowledge base.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            isTeachingSuccess: true,
            taughtFacts: facts.length > 0 ? facts : [{ topic: 'Operational Rule', detail: textToSend }],
          };
          setCurrentMessages(prev => [...prev, aiMsg]);
          setDrawerRefreshTrigger(prev => prev + 1);
          setStatusMessage('Saved to knowledge base.');
          setTimeout(() => setStatusMessage(null), 4000);
        } else {
          setCurrentMessages(prev => [
            ...prev,
            {
              id: `ai_${Date.now()}`,
              sender: 'ai',
              mode: 'teach',
              text: data.error || 'Failed to record instruction.',
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
          ]);
        }
        setIsLoading(false);
        return;
      }

      // 3. TEST MODE: ACTUAL CHANNEL SIMULATION (WHATSAPP OR EMAIL)
      const res = await fetch('/api/chat/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          channel: activeChannel,
          message: textToSend,
          senderName: simSenderName,
          senderEmail: simSenderEmail,
          senderPhone: '+60123456789',
          subject: simSubject,
          history: currentMessages.slice(-6).map(m => ({
            sender: m.sender,
            text: m.text,
          })),
        }),
      });
      const data = await res.json();

      if (data.success) {
        const aiMsg: Message = {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          mode: 'test',
          channel: activeChannel,
          text: data.replyText,
          subject: data.subject,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: data.status,
          citations: data.citations,
          attachedAssets: data.attachedAssets,
          confidenceScore: data.confidenceScore || data.ragConfidence,
          queuedToClarifications: data.queuedToClarifications,
          clarificationQuestion: data.clarificationQuestion,
          actionExecuted: data.actionExecuted,
          mediaUrl: data.mediaUrl,
          mediaFilename: data.mediaFilename,
        };
        setCurrentMessages(prev => [...prev, aiMsg]);
        if (data.queuedToClarifications) {
          setStatusMessage('Question queued to Clarifications for business confirmation.');
          setTimeout(() => setStatusMessage(null), 5000);
        }
      } else {
        setCurrentMessages(prev => [
          ...prev,
          {
            id: `ai_${Date.now()}`,
            sender: 'ai',
            mode: 'test',
            channel: activeChannel,
            text: data.error || 'Failed to simulate inquiry.',
            timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            status: 'irrelevant',
          },
        ]);
      }
    } catch (err: any) {
      console.error('Chat error:', err);
      setCurrentMessages(prev => [
        ...prev,
        {
          id: `ai_${Date.now()}`,
          sender: 'ai',
          text: 'Unable to communicate with Krayn AI right now. Please check your connection and try again.',
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'irrelevant',
        },
      ]);
    } finally {
      setIsLoading(false);
      setIsUploadingFile(false);
    }
  };

  // Confirm or adjust verified asset triggers in chat
  const handleConfirmAssetVerification = async (
    msgId: string,
    assetId: string,
    customWhenToShare?: string
  ) => {
    try {
      const res = await fetch('/api/assets', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: assetId,
          ...(customWhenToShare ? { whenToShare: customWhenToShare } : {}),
        }),
      });
      const data = await res.json();
      if (data.success) {
        setTeachMessages(prev =>
          prev.map(m => {
            if (m.id === msgId && m.teachingVerification) {
              return {
                ...m,
                teachingVerification: {
                  ...m.teachingVerification,
                  isConfirmed: true,
                  detectedWhenToShare: customWhenToShare || m.teachingVerification.detectedWhenToShare,
                },
              };
            }
            return m;
          })
        );
        setDrawerRefreshTrigger(prev => prev + 1);
        setStatusMessage('Collateral triggers confirmed and active.');
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.error('Error confirming verification:', err);
    }
  };

  const handleResetCurrentThread = () => {
    if (activeMode === 'teach') {
      setTeachMessages([
        {
          id: 'welcome_teach',
          sender: 'ai',
          mode: 'teach',
          text: "You can teach me rules, policies, or attach files like menus and brochures. I'll learn them and use them to answer customers.",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'answered',
        },
      ]);
    } else if (activeChannel === 'whatsapp') {
      setWhatsappMessages([
        {
          id: 'welcome_wa',
          sender: 'ai',
          mode: 'test',
          channel: 'whatsapp',
          text: "Hello! Welcome to Park Hyatt Kuala Lumpur. How can I help you?",
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'answered',
          actionExecuted: 'Official WhatsApp Concierge connected',
          confidenceScore: 100,
        },
      ]);
    } else {
      setEmailMessages([
        {
          id: 'welcome_email',
          sender: 'ai',
          mode: 'test',
          channel: 'email',
          subject: 'Welcome to Park Hyatt Kuala Lumpur Guest Relations',
          text: `Dear Guest,\n\nWelcome to Park Hyatt Kuala Lumpur. How can I help you?\n\nWarm regards,\nPark Hyatt Kuala Lumpur\nMenara Merdeka Maybank, 50118 Kuala Lumpur\nTel: +60 3 2333 1234 | kualalumpur.park@hyatt.com\nwww.hyatt.com/park-hyatt/en-US/kulph-park-hyatt-kuala-lumpur`,
          timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          status: 'answered',
          actionExecuted: 'Official Guest Relations connected',
          confidenceScore: 100,
        },
      ]);
    }
  };

  const sampleTeachPrompts = [
    'We offer complimentary valet parking for all suite guests.',
    'Breakfast at Merdeka Grill is served from 6:30 AM to 10:30 AM.',
    'Late checkout is available until 2:00 PM for MYR 150 upon request.',
    'Park Suite bookings include complimentary high-floor evening refreshments.',
  ];

  const sampleWhatsAppPrompts = [
    'What time is the pool open until?',
    'What are the breakfast hours at Merdeka Grill?',
    'What are the gym and fitness centre opening hours?',
    'What are the parking charges for visitors?',
  ];

  const sampleEmailPrompts = [
    'Could you confirm your breakfast hours and dietary options at Merdeka Grill?',
    'What are the parking fees for non-hotel guests visiting for dinner?',
    'Is Wi-Fi complimentary throughout the property and in guest rooms?',
    'What are the standard check-in and check-out times?',
  ];

  return (
    <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden font-sans">
      {/* Messages Feed Area */}
      <div className="flex-1 overflow-y-auto px-3 sm:px-6 md:px-8 py-5">
        <div className="max-w-3xl mx-auto space-y-4">


          {/* Messages Feed */}
          <div className="space-y-4">
            {currentMessages.map(msg => (
              <div key={msg.id} className="transition-all duration-200">
                {msg.sender === 'user' ? (
                  /* User message bubble */
                  <div className="flex items-end justify-end">
                    <div className="flex flex-col items-end max-w-[85%] sm:max-w-[75%]">
                      <div className={`px-4 py-2.5 text-white text-[14px] leading-relaxed rounded-2xl rounded-br-sm break-words shadow-2xs ${
                        msg.channel === 'whatsapp'
                          ? 'bg-[#25D366]'
                          : msg.channel === 'email'
                            ? 'bg-[#1D63D8]'
                            : 'bg-[#FF751F]'
                      }`}>
                        {msg.text}
                      </div>
                      <span className="text-[10px] text-gray-400 mt-1 px-1 flex items-center gap-1">
                        <span>
                          {msg.mode === 'teach'
                            ? 'Taught Fact'
                            : msg.channel === 'whatsapp'
                              ? 'Guest WhatsApp'
                              : 'Incoming Guest Email'}
                        </span>
                        <span>•</span>
                        <span>{msg.timestamp}</span>
                      </span>
                    </div>
                  </div>
                ) : (
                  /* AI message bubble */
                  <div className="flex items-start justify-start">
                    <div className="flex flex-col items-start max-w-[92%] sm:max-w-[84%] space-y-2">
                      <div className="px-5 py-4 bg-[#F2F2F7] text-[#1D1D1F] text-[14px] leading-relaxed rounded-2xl rounded-tl-sm break-words w-full shadow-none">


                        {/* Body Text with Clean Formatting */}
                        <div className="text-gray-900 leading-relaxed font-normal space-y-1.5 text-[14px]">
                          {msg.text.split('\n').map((line, lIdx) => {
                            const trimmed = line.trim();
                            if (!trimmed) {
                              return <div key={lIdx} className="h-2" />;
                            }

                            // Clean heading or bullet line
                            const isBullet = trimmed.startsWith('* ') || trimmed.startsWith('- ') || trimmed.startsWith('• ');
                            const rawContent = isBullet ? trimmed.replace(/^[\*\-•]\s*/, '') : trimmed;

                            // Parse bold tokens like **text** or *text* cleanly
                            const parts = rawContent.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/g);

                            const formattedLine = parts.map((part, pIdx) => {
                              if (part.startsWith('**') && part.endsWith('**')) {
                                return (
                                  <strong key={pIdx} className="font-semibold text-gray-950">
                                    {part.slice(2, -2)}
                                  </strong>
                                );
                              }
                              if (part.startsWith('*') && part.endsWith('*')) {
                                return (
                                  <strong key={pIdx} className="font-semibold text-gray-950">
                                    {part.slice(1, -1)}
                                  </strong>
                                );
                              }
                              return <span key={pIdx}>{part}</span>;
                            });

                            if (isBullet) {
                              return (
                                <div key={lIdx} className="flex items-start gap-2 pl-1">
                                  <span className="text-gray-400 select-none">•</span>
                                  <div className="flex-1">{formattedLine}</div>
                                </div>
                              );
                            }

                            return (
                              <p key={lIdx} className="leading-relaxed">
                                {formattedLine}
                              </p>
                            );
                          })}
                        </div>

                        {/* WhatsApp Generated Media Attachment (e.g. PDF Agreement) */}
                        {msg.mediaUrl && (
                          <div className="mt-3 p-3 rounded-xl bg-emerald-100 text-emerald-950 flex items-center justify-between">
                            <div className="flex items-center gap-2 min-w-0">
                              <FileText className="w-5 h-5 text-emerald-700 shrink-0" />
                              <div className="truncate">
                                <p className="text-xs font-semibold text-gray-900 truncate">
                                  {msg.mediaFilename || 'Reservation_Agreement.pdf'}
                                </p>
                                <p className="text-[10px] text-gray-600">
                                  Automated PDF Agreement sent via WhatsApp Media
                                </p>
                              </div>
                            </div>
                            <a
                              href={msg.mediaUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold flex items-center gap-1 ml-2 shrink-0 transition"
                            >
                              <span>View PDF</span>
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          </div>
                        )}

                        {/* Email Attached Assets (PDFs/Images) */}
                        {msg.attachedAssets && msg.attachedAssets.length > 0 && (
                          <div className="mt-3 p-3.5 rounded-xl bg-blue-100 text-blue-950 space-y-2">
                            <span className="text-[10px] uppercase tracking-wider font-semibold text-blue-900 block">
                              Attached Email Collateral:
                            </span>
                            <div className="space-y-1.5">
                              {msg.attachedAssets.map(asset => (
                                <div
                                  key={asset.id}
                                  className="flex items-center justify-between p-2.5 rounded-lg bg-white text-xs"
                                >
                                  <div className="flex items-center gap-2 min-w-0">
                                    {asset.mimeType?.startsWith('image/') ? (
                                      <ImageIcon className="w-4 h-4 text-blue-600 shrink-0" />
                                    ) : (
                                      <FileText className="w-4 h-4 text-blue-600 shrink-0" />
                                    )}
                                    <div className="truncate">
                                      <p className="font-semibold text-gray-900 truncate">{asset.name}</p>
                                      <p className="text-[10px] text-gray-500 truncate">
                                        {asset.purpose || 'Official hotel document attached'}
                                      </p>
                                    </div>
                                  </div>
                                  <a
                                    href={asset.url || `/api/assets/file?id=${encodeURIComponent(asset.id)}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="text-blue-600 hover:text-blue-800 text-[11px] font-semibold flex items-center gap-1 ml-2 shrink-0"
                                  >
                                    <span>Download</span>
                                    <ExternalLink className="w-3 h-3" />
                                  </a>
                                </div>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* TEACHING SUCCESS BREAKDOWN */}
                        {msg.isTeachingSuccess && msg.taughtFacts && (
                          <div className="mt-2.5 space-y-1">
                            {msg.taughtFacts.map((fact, idx) => (
                              <div key={idx} className="text-xs text-gray-800 flex items-start gap-1.5">
                                <span className="font-semibold text-gray-900 shrink-0">• {fact.topic}:</span>
                                <span className="text-gray-700">{fact.detail}</span>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* TEACHING VERIFICATION CARD FOR UPLOADED MEDIA */}
                        {msg.teachingVerification && (
                          <div className="mt-3 p-3.5 rounded-xl bg-orange-100 text-orange-950 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                              <div className="flex items-center gap-2">
                                <div className="w-8 h-8 rounded-lg bg-[#FF751F] text-white flex items-center justify-center shrink-0">
                                  {msg.teachingVerification.mimeType.startsWith('image/') ? (
                                    <ImageIcon className="w-4 h-4" />
                                  ) : (
                                    <FileText className="w-4 h-4" />
                                  )}
                                </div>
                                <div className="min-w-0">
                                  <h4 className="text-xs font-semibold text-gray-900 truncate">
                                    {msg.teachingVerification.originalName}
                                  </h4>
                                  <span className="text-[10px] text-gray-600">
                                    Identified as: {msg.teachingVerification.detectedType}
                                  </span>
                                </div>
                              </div>

                              <a
                                href={`/api/assets/file?id=${encodeURIComponent(msg.teachingVerification.assetId)}`}
                                target="_blank"
                                rel="noreferrer"
                                className="text-blue-700 hover:text-blue-900 text-[11px] font-semibold flex items-center gap-1 shrink-0"
                              >
                                <span>Preview</span>
                                <ExternalLink className="w-3 h-3" />
                              </a>
                            </div>

                            <div className="space-y-1.5 text-xs bg-white p-3 rounded-lg">
                              <div>
                                <span className="font-semibold text-gray-800">Detected Purpose: </span>
                                <span className="text-gray-600">
                                  {msg.teachingVerification.detectedPurpose}
                                </span>
                              </div>
                              <div>
                                <span className="font-semibold text-emerald-800">When to share: </span>
                                <span className="text-gray-600">
                                  {msg.teachingVerification.detectedWhenToShare}
                                </span>
                              </div>
                              {msg.teachingVerification.extractedFactsCount > 0 && (
                                <div className="pt-1 text-[11px] text-[#FF751F] font-semibold flex items-center gap-1">
                                  <Sparkles className="w-3 h-3" />
                                  <span>
                                    Extracted {msg.teachingVerification.extractedFactsCount} operational facts for direct answers.
                                  </span>
                                </div>
                              )}
                            </div>

                            {/* Confirmation Action */}
                            {!msg.teachingVerification.isConfirmed ? (
                              <div className="flex items-center gap-2 pt-1">
                                <button
                                  type="button"
                                  onClick={() =>
                                    handleConfirmAssetVerification(
                                      msg.id,
                                      msg.teachingVerification!.assetId
                                    )
                                  }
                                  className="flex-1 py-2 px-3 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold flex items-center justify-center gap-1.5 transition-colors cursor-pointer"
                                >
                                  <Check className="w-3.5 h-3.5" />
                                  <span>Confirm Sharing Rule</span>
                                </button>
                                <button
                                  type="button"
                                  onClick={() => {
                                    const custom = prompt(
                                      'When should the AI share this file?',
                                      msg.teachingVerification!.detectedWhenToShare
                                    );
                                    if (custom) {
                                      handleConfirmAssetVerification(
                                        msg.id,
                                        msg.teachingVerification!.assetId,
                                        custom
                                      );
                                    }
                                  }}
                                  className="py-2 px-3 rounded-lg bg-white hover:bg-gray-100 text-gray-800 text-xs font-semibold transition-colors cursor-pointer"
                                >
                                  Customize
                                </button>
                              </div>
                            ) : (
                              <div className="flex items-center gap-1.5 text-emerald-800 text-xs font-semibold bg-emerald-100 py-2 px-3 rounded-lg">
                                <CheckCircle2 className="w-4 h-4 text-emerald-700" />
                                <span>Sharing rules verified & active for customer inquiries.</span>
                              </div>
                            )}
                          </div>
                        )}

                      </div>

                      <span className="text-[10px] text-gray-400 px-1">
                        {msg.timestamp}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {/* Typing / Thinking Indicator */}
            {isLoading && (
              <div className="flex items-start justify-start">
                <div className="px-4 py-2.5 bg-[#F2F2F7] rounded-2xl rounded-tl-sm flex items-center gap-3 text-xs text-gray-500 shadow-none">
                  <div className="flex items-center gap-1 py-0.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:-0.32s] ${
                        activeChannel === 'whatsapp' ? 'bg-emerald-600' : 'bg-gray-500'
                      }`}
                    />
                    <span
                      className={`w-1.5 h-1.5 rounded-full animate-bounce [animation-delay:-0.16s] ${
                        activeChannel === 'whatsapp' ? 'bg-emerald-600' : 'bg-gray-500'
                      }`}
                    />
                    <span
                      className={`w-1.5 h-1.5 rounded-full animate-bounce ${
                        activeChannel === 'whatsapp' ? 'bg-emerald-600' : 'bg-gray-500'
                      }`}
                    />
                  </div>
                  <span className="font-normal text-gray-500">
                    {activeChannel === 'whatsapp' ? 'Typing...' : 'Thinking...'}
                  </span>
                </div>
              </div>
            )}

            <div ref={chatEndRef} />
          </div>
        </div>
      </div>

      {/* Input Bar pinned to bottom - moved slightly up */}
      <div className="bg-white px-3 sm:px-5 pt-1.5 pb-6 sm:pb-8 shrink-0">
        <div className="max-w-3xl mx-auto space-y-2.5">
          {/* Quick Prompts when few messages - 1 Column directly above textbox */}
          {currentMessages.length <= 2 && (
            <div className="space-y-1.5 pb-0.5">
              <div className="flex flex-col gap-1.5">
                {(activeMode === 'teach'
                  ? sampleTeachPrompts
                  : activeChannel === 'whatsapp'
                    ? sampleWhatsAppPrompts
                    : sampleEmailPrompts
                ).map((prompt, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleSendMessage(prompt)}
                    className="w-full text-left px-4 py-2.5 rounded-xl bg-[#F2F2F7] hover:bg-gray-200 text-[13px] text-gray-800 font-medium transition-colors flex items-center justify-between cursor-pointer"
                  >
                    <span className="truncate">{prompt}</span>
                    <ArrowUp className="w-3.5 h-3.5 text-gray-400 shrink-0 rotate-45 ml-2" />
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Staged File Card preview if selected */}
          {stagedFile && (
            <div className="flex items-center justify-between p-2.5 rounded-xl bg-orange-100 text-orange-950 animate-in fade-in duration-150">
              <div className="flex items-center gap-2.5 min-w-0">
                {filePreviewUrl ? (
                  <img
                    src={filePreviewUrl}
                    alt="Preview"
                    className="w-10 h-10 object-cover rounded-lg shrink-0"
                  />
                ) : (
                  <div className="w-10 h-10 rounded-lg bg-[#FF751F] text-white flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5" />
                  </div>
                )}
                <div className="min-w-0">
                  <p className="text-xs font-semibold text-gray-900 truncate">{stagedFile.name}</p>
                  <p className="text-[10px] text-gray-600">
                    {(stagedFile.size / 1024).toFixed(0)} KB • Will index facts & enable customer sharing
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={removeStagedFile}
                className="p-1 text-gray-500 hover:text-gray-800 rounded-lg cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          )}

          <form
            onSubmit={e => {
              e.preventDefault();
              handleSendMessage();
            }}
            className="flex items-center gap-2"
          >
            {/* File Upload Attachment Button (Teach mode only) */}
            {activeMode === 'teach' && (
              <>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileSelect}
                  accept="image/*,application/pdf"
                  className="hidden"
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  title="Attach PDF or Image to teach AI"
                  disabled={isLoading}
                  className={`h-[46px] w-[46px] rounded-2xl flex items-center justify-center transition-colors cursor-pointer shrink-0 ${
                    stagedFile ? 'bg-orange-100 text-[#FF751F]' : 'bg-[#F2F2F7] text-gray-600 hover:bg-gray-200'
                  }`}
                >
                  <Paperclip className="w-4 h-4" />
                </button>
              </>
            )}

            <input
              type="text"
              value={inputQuery}
              onChange={e => setInputQuery(e.target.value)}
              placeholder={
                activeMode === 'teach'
                  ? stagedFile
                    ? 'Add description (e.g. "Dinner menu for Merdeka Grill")...'
                    : 'Teach Krayn AI new guidelines or facts...'
                  : activeChannel === 'whatsapp'
                    ? 'Type message as customer on WhatsApp (e.g. "What time is pool open?")...'
                    : 'Type incoming customer email message...'
              }
              disabled={isLoading}
              className="flex-1 min-h-[46px] px-4 rounded-2xl bg-white border border-[#E5E5E7] text-xs sm:text-[13px] font-medium text-gray-900 placeholder:text-gray-400 outline-none shadow-none focus:border-gray-300 transition-colors"
            />

            <button
              type="submit"
              disabled={isLoading || (!inputQuery.trim() && !stagedFile)}
              className={`h-[46px] w-[46px] rounded-2xl text-white flex items-center justify-center transition-all duration-200 cursor-pointer disabled:opacity-40 disabled:hover:translate-y-0 disabled:shadow-none hover:-translate-y-0.5 active:translate-y-0 shrink-0 shadow-sm hover:shadow-md ${
                activeMode === 'teach'
                  ? 'bg-[#FF751F] hover:bg-[#e06518]'
                  : activeChannel === 'whatsapp'
                    ? 'bg-[#25D366] hover:bg-[#20bd5a]'
                    : 'bg-[#1D63D8] hover:bg-[#1651b5]'
              }`}
              title="Send"
            >
              <ArrowUp className="w-4 h-4" />
            </button>
          </form>
        </div>
      </div>

      {/* Slide-over Live Knowledge Hub Drawer */}
      <KnowledgeDrawer
        isOpen={isDrawerOpen}
        onClose={() => setIsDrawerOpen(false)}
        refreshTrigger={drawerRefreshTrigger}
        onItemCountChange={(fCount, aCount) => {
          setFactsCount(fCount);
          setAssetsCount(aCount);
        }}
      />

      {/* Real-time Hands-Free Voice Teach Modal */}
      <VoiceTeachModal
        isOpen={isVoiceModalOpen}
        onClose={() => setIsVoiceModalOpen(false)}
        onFactTaught={() => setDrawerRefreshTrigger(prev => prev + 1)}
      />
    </main>
  );
}

export default function ChatPage() {
  return (
    <div className="flex h-screen bg-white overflow-hidden text-[#1D1D1F]">
      <Sidebar />
      <Suspense fallback={<div className="flex-1 p-6 text-xs text-gray-400">Loading AI Chat...</div>}>
        <ChatContent />
      </Suspense>
    </div>
  );
}
