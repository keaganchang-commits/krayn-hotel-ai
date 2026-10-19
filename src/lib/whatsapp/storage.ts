import fs from 'fs';
import path from 'path';

export interface WhatsAppMessage {
  id: string;
  from: string; // phone number e.g. "+60123456789"
  to: string;
  senderName: string;
  text: string;
  timestamp: string;
  direction: 'inbound' | 'outbound';
  status: 'received' | 'sent' | 'delivered';
  actionExecuted?: string; // e.g. "Auto-booked Merdeka Grill (2 pax) on Google Calendar"
  ragConfidence?: number;
}

export interface WhatsAppChat {
  phoneNumber: string; // e.g. "+60123456789"
  contactName: string;
  lastMessage: string;
  lastTimestamp: string;
  unreadCount: number;
  messages: WhatsAppMessage[];
}

const DATA_DIR = path.join(process.cwd(), 'data');
const CHATS_FILE = path.join(DATA_DIR, 'whatsapp_chats.json');

function ensureFile() {
  try {
    if (!fs.existsSync(DATA_DIR)) {
      try { fs.mkdirSync(DATA_DIR, { recursive: true }); } catch {}
    }
    if (!fs.existsSync(CHATS_FILE)) {
      try { fs.writeFileSync(CHATS_FILE, JSON.stringify([], null, 2), 'utf8'); } catch {}
    }
  } catch {}
}

export function listWhatsAppChats(): WhatsAppChat[] {
  ensureFile();
  try {
    if (fs.existsSync(CHATS_FILE)) {
      const raw = fs.readFileSync(CHATS_FILE, 'utf8');
      const chats: WhatsAppChat[] = JSON.parse(raw);
      return chats.sort((a, b) => new Date(b.lastTimestamp).getTime() - new Date(a.lastTimestamp).getTime());
    }
  } catch (err) {
    console.error('Error reading whatsapp_chats.json:', err);
  }
  return [];
}

export function getWhatsAppChat(phoneNumber: string): WhatsAppChat | null {
  const chats = listWhatsAppChats();
  return chats.find(c => c.phoneNumber === phoneNumber) || null;
}

export function saveWhatsAppMessage(message: Omit<WhatsAppMessage, 'id'>): WhatsAppMessage {
  ensureFile();
  const chats = listWhatsAppChats();
  const id = `wamsg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const fullMsg: WhatsAppMessage = { id, ...message };

  const chatIdx = chats.findIndex(c => c.phoneNumber === message.from || c.phoneNumber === message.to);

  const contactPhone = message.direction === 'inbound' ? message.from : message.to;
  const contactName = message.senderName || contactPhone;

  if (chatIdx >= 0) {
    chats[chatIdx].messages.push(fullMsg);
    chats[chatIdx].lastMessage = fullMsg.text;
    chats[chatIdx].lastTimestamp = fullMsg.timestamp;
    if (message.direction === 'inbound') {
      chats[chatIdx].unreadCount = (chats[chatIdx].unreadCount || 0) + 1;
    }
  } else {
    chats.unshift({
      phoneNumber: contactPhone,
      contactName,
      lastMessage: fullMsg.text,
      lastTimestamp: fullMsg.timestamp,
      unreadCount: message.direction === 'inbound' ? 1 : 0,
      messages: [fullMsg],
    });
  }

  try {
    fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), 'utf8');
  } catch (writeErr) {
    console.warn('[WhatsApp Storage] Could not persist to disk (serverless read-only disk):', writeErr);
  }
  return fullMsg;
}

export function markWhatsAppChatAsRead(phoneNumber: string): boolean {
  ensureFile();
  const chats = listWhatsAppChats();
  const chat = chats.find(c => c.phoneNumber === phoneNumber);
  if (chat) {
    chat.unreadCount = 0;
    try {
      fs.writeFileSync(CHATS_FILE, JSON.stringify(chats, null, 2), 'utf8');
    } catch {}
    return true;
  }
  return false;
}
