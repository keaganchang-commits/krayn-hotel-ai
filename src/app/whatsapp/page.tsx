'use client';

import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  MessageSquare,
  Search,
  Send,
  CheckCheck,
  Zap,
  Calendar,
  Sparkles,
  Phone,
  RefreshCw,
  ExternalLink,
  ShieldCheck,
  Bot
} from 'lucide-react';

interface WhatsAppMessage {
  id: string;
  from: string;
  to: string;
  senderName: string;
  text: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  status: 'received' | 'sent' | 'delivered';
  actionExecuted?: string;
  ragConfidence?: number;
}

interface WhatsAppChat {
  phoneNumber: string;
  contactName: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: WhatsAppMessage[];
}

export default function WhatsAppChatsPage() {
  const [chats, setChats] = useState<WhatsAppChat[]>([]);
  const [activeChatPhone, setActiveChatPhone] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [inputText, setInputText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [isConfigured, setIsConfigured] = useState(false);
  const [twilioNumber, setTwilioNumber] = useState('+17372508034');
  const [isLoading, setIsLoading] = useState(true);

  const messagesEndRef = useRef<HTMLDivElement>(null);

  const fetchChats = async () => {
    try {
      const res = await fetch('/api/whatsapp/chats');
      const data = await res.json();
      if (data.success) {
        setChats(data.chats || []);
        setIsConfigured(!!data.configured);
        if (data.twilioNumber) setTwilioNumber(data.twilioNumber);

        // If no active chat selected yet, select first chat
        if (!activeChatPhone && data.chats && data.chats.length > 0) {
          setActiveChatPhone(data.chats[0].phoneNumber);
        }
      }
    } catch (err) {
      console.error('Failed to load WhatsApp chats:', err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchChats();
    // Poll every 3 seconds for real-time live WhatsApp chat sync
    const interval = setInterval(fetchChats, 3000);
    return () => clearInterval(interval);
  }, [activeChatPhone]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chats, activeChatPhone]);

  const activeChat = chats.find(c => c.phoneNumber === activeChatPhone);

  const handleSelectChat = async (phone: string) => {
    setActiveChatPhone(phone);
    try {
      await fetch('/api/whatsapp/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'mark_read', to: phone }),
      });
      setChats(prev => prev.map(c => c.phoneNumber === phone ? { ...c, unreadCount: 0 } : c));
    } catch (err) {
      console.error('Failed to mark chat read:', err);
    }
  };

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || !activeChatPhone || isSending) return;

    const messageText = inputText.trim();
    setInputText('');
    setIsSending(true);

    try {
      const res = await fetch('/api/whatsapp/chats', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'send',
          to: activeChatPhone,
          text: messageText,
        }),
      });
      const data = await res.json();
      if (data.success) {
        fetchChats();
      } else {
        alert(data.error || 'Failed to send WhatsApp message');
      }
    } catch (err) {
      console.error('Error sending WhatsApp message:', err);
    } finally {
      setIsSending(false);
    }
  };

  const filteredChats = chats.filter(c =>
    c.contactName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    c.phoneNumber.includes(searchQuery) ||
    c.lastMessage.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="flex h-screen bg-white overflow-hidden text-gray-900 font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col h-full bg-[#F5F5F7] overflow-hidden">
        {/* Two-Pane Chat Layout (Apple Messages / WhatsApp Desktop Style) */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Chat Conversation List */}
          <section aria-label="Conversation list" className="w-80 md:w-96 bg-white border-r border-[#E5E5E7] flex flex-col shrink-0">
            {/* Search Bar */}
            <div className="p-3 border-b border-[#E5E5E7]">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search contacts or chats..."
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full bg-[#F5F5F7] rounded-xl pl-9 pr-3 py-1.5 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-emerald-500 transition"
                />
              </div>
            </div>

            {/* List of Conversations */}
            <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
              {isLoading ? (
                <div className="py-12 flex flex-col items-center justify-center text-gray-400 space-y-2">
                  <RefreshCw className="w-4 h-4 animate-spin text-emerald-600" />
                  <span className="text-xs">Loading WhatsApp chats...</span>
                </div>
              ) : filteredChats.length === 0 ? (
                <div className="p-6 text-center text-xs text-gray-400 space-y-2">
                  <Bot className="w-8 h-8 text-gray-300 mx-auto" />
                  <p className="font-semibold text-gray-700">No WhatsApp messages yet</p>
                  <p className="text-[11px] text-gray-400 leading-relaxed">
                    Send a test message from your phone to the Twilio WhatsApp sandbox number to start interacting live with Krayn AI.
                  </p>
                </div>
              ) : (
                filteredChats.map(chat => {
                  const isSelected = chat.phoneNumber === activeChatPhone;
                  return (
                    <button
                      key={chat.phoneNumber}
                      type="button"
                      onClick={() => handleSelectChat(chat.phoneNumber)}
                      className={`w-full text-left p-3.5 flex items-start gap-3 transition-colors cursor-pointer ${
                        isSelected ? 'bg-emerald-50/60 border-l-3 border-emerald-500' : 'hover:bg-gray-50'
                      }`}
                    >
                      <div className="w-10 h-10 rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white flex items-center justify-center font-bold text-xs shrink-0 shadow-xs">
                        {chat.contactName.slice(0, 2).toUpperCase()}
                      </div>

                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-1 mb-1">
                          <span className="text-xs font-semibold text-gray-900 truncate">
                            {chat.contactName}
                          </span>
                          <span className="text-[10px] text-gray-400 shrink-0">
                            {new Date(chat.lastTimestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </span>
                        </div>

                        <p className="text-xs text-gray-500 truncate leading-snug">
                          {chat.lastMessage}
                        </p>

                        {chat.unreadCount > 0 && (
                          <div className="mt-1 flex justify-end">
                            <span className="bg-emerald-500 text-white text-[10px] font-bold px-1.5 py-0.5 rounded-full leading-none">
                              {chat.unreadCount}
                            </span>
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          </section>

          {/* Right: Active Chat Conversation View */}
          <section aria-label="Active conversation" className="flex-1 flex flex-col bg-[#EFEAE2]/30 relative overflow-hidden">
            {activeChat ? (
              <>
                {/* Active Chat Header */}
                <div className="h-14 bg-white border-b border-[#E5E5E7] px-6 flex items-center justify-between shrink-0 shadow-2xs">
                  <div className="flex items-center gap-3">
                    <div className="w-9 h-9 rounded-full bg-emerald-500 text-white flex items-center justify-center font-bold text-xs">
                      {activeChat.contactName.slice(0, 2).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-gray-900">{activeChat.contactName}</p>
                      <p className="text-[11px] text-gray-400 font-mono">{activeChat.phoneNumber}</p>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 border border-emerald-200 text-[11px] font-medium">
                      <Zap className="w-3 h-3 text-emerald-600" />
                      Auto-Pilot Live
                    </span>
                  </div>
                </div>

                {/* Messages Scroll Area */}
                <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
                  {activeChat.messages.map(msg => {
                    const isInbound = msg.direction === 'inbound';

                    return (
                      <div
                        key={msg.id}
                        className={`flex flex-col ${isInbound ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[78%] sm:max-w-[65%] rounded-2xl p-3.5 shadow-2xs space-y-1.5 ${
                            isInbound
                              ? 'bg-white text-gray-900 border border-black/5 rounded-tl-xs'
                              : 'bg-emerald-600 text-white rounded-tr-xs'
                          }`}
                        >
                          {/* Sender Label */}
                          <div className="flex items-center justify-between gap-3 text-[10px] opacity-75">
                            <span className="font-semibold">{msg.senderName}</span>
                            <span>
                              {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                            </span>
                          </div>

                          {/* Message Text */}
                          <p className="text-xs sm:text-[13px] leading-relaxed whitespace-pre-wrap font-sans">
                            {msg.text}
                          </p>

                          {/* Autonomous Action Badge (if executed) */}
                          {msg.actionExecuted && (
                            <div className={`mt-2 pt-1.5 border-t flex items-center gap-1.5 text-[10px] font-semibold ${
                              isInbound ? 'border-gray-100 text-emerald-700' : 'border-white/20 text-emerald-100'
                            }`}>
                              <Sparkles className="w-3 h-3 shrink-0" />
                              <span>Action: {msg.actionExecuted}</span>
                            </div>
                          )}
                        </div>
                      </div>
                    );
                  })}
                  <div ref={messagesEndRef} />
                </div>

                {/* Bottom Reply Composer */}
                <form
                  onSubmit={handleSendMessage}
                  className="bg-white border-t border-[#E5E5E7] p-3.5 flex items-center gap-2 shrink-0"
                >
                  <input
                    type="text"
                    value={inputText}
                    onChange={e => setInputText(e.target.value)}
                    placeholder="Type a WhatsApp message or command..."
                    className="flex-1 bg-[#F5F5F7] border border-transparent rounded-xl px-4 py-2.5 text-xs text-gray-900 placeholder:text-gray-400 outline-none focus:border-emerald-500 focus:bg-white transition"
                  />
                  <button
                    type="submit"
                    disabled={isSending || !inputText.trim()}
                    className="p-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white transition disabled:opacity-40 cursor-pointer shadow-xs"
                    title="Send WhatsApp message"
                  >
                    <Send className="w-4 h-4" />
                  </button>
                </form>
              </>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8 space-y-3">
                <div className="w-12 h-12 rounded-2xl bg-white border border-black/10 flex items-center justify-center text-emerald-600 shadow-xs">
                  <Phone className="w-6 h-6" />
                </div>
                <h3 className="text-sm font-bold text-gray-800">Select a WhatsApp Conversation</h3>
                <p className="text-xs text-gray-500 max-w-sm leading-relaxed">
                  Choose a conversation on the left to monitor live customer inquiries, AI answers, and automated calendar actions.
                </p>
              </div>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
