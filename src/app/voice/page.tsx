'use client';

import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  Mic,
  MicOff,
  Volume2,
  VolumeX,
  Sparkles,
  AlertCircle,
  RefreshCw,
  CheckCircle2,
  Database,
  ArrowRight,
  BookOpen,
  Trash2,
  MessageSquare,
  HelpCircle,
  Flame
} from 'lucide-react';
import Link from 'next/link';
import { motion, AnimatePresence } from 'framer-motion';

interface LearnedRule {
  id?: string;
  topic: string;
  detail: string;
  timestamp: string;
}

export type VoiceMode = 'assisted';

export default function VoicePage() {
  const [isListening, setIsListening] = useState(false);
  const [isPreparingMic, setIsPreparingMic] = useState(false);
  const [isUserSpeaking, setIsUserSpeaking] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([
    {
      role: 'ai',
      text: 'Hi! Would you like me to prompt you on missing policies, or do you have something to add?',
    },
  ]);
  const [learnedRules, setLearnedRules] = useState<LearnedRule[]>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [isSyncingKnowledge, setIsSyncingKnowledge] = useState(false);
  const [syncedCount, setSyncedCount] = useState<number | null>(null);
  const isPreparingMicRef = useRef<boolean>(false);
  const micWarmupTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const hasGreetedRef = useRef<boolean>(false);
  const awaitingFirstGreetingRef = useRef<boolean>(false);
  const pendingGreetingPromptRef = useRef<string | null>(null);
  const micSafetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const micStoppedByUserRef = useRef<boolean>(true);

  isPreparingMicRef.current = isPreparingMic;

  // Audio Context & WebSocket refs for Gemini Live native streaming
  const audioContextRef = useRef<AudioContext | null>(null);
  const scheduledTimeRef = useRef<number>(0);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const wsReadyRef = useRef<boolean>(false);
  const isSpeakingRef = useRef<boolean>(false);
  const isMutedRef = useRef<boolean>(false);
  const historyRef = useRef<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const transcriptBufferRef = useRef<string>('');
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const userSpeakingTimerRef = useRef<NodeJS.Timeout | null>(null);
  const recognitionRef = useRef<any>(null);
  const currentAiUtteranceRef = useRef<string>('');
  const lastAiSpeechEndRef = useRef<number>(0);

  const isListeningRef = useRef<boolean>(false);

  isListeningRef.current = isListening;
  isSpeakingRef.current = isSpeaking;
  isMutedRef.current = isMuted;
  historyRef.current = history;

  // Initialize Audio Context for 24kHz native linear PCM playback
  const ensureAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
      }
    }
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(() => {});
    }
    return audioContextRef.current;
  };

  // Convert Base64 raw 16-bit linear PCM at 24kHz to Web Audio buffer
  const playPcmChunk = (base64Data: string) => {
    if (isMutedRef.current) return;
    const ctx = ensureAudioContext();
    if (!ctx) return;

    try {
      const binaryString = window.atob(base64Data);
      const len = binaryString.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      const int16Array = new Int16Array(bytes.buffer);
      const float32Array = new Float32Array(int16Array.length);
      for (let i = 0; i < int16Array.length; i++) {
        float32Array[i] = int16Array[i] / 32768.0;
      }

      const audioBuffer = ctx.createBuffer(1, float32Array.length, 24000);
      audioBuffer.copyToChannel(float32Array, 0);

      const source = ctx.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(ctx.destination);

      const currentTime = ctx.currentTime;
      // Snappy 40ms buffer lead time when starting from idle for instantaneous low-latency playback
      if (scheduledTimeRef.current < currentTime) {
        scheduledTimeRef.current = currentTime + 0.04;
      }

      source.start(scheduledTimeRef.current);
      scheduledTimeRef.current += audioBuffer.duration;

      activeSourcesRef.current.push(source);
      setIsSpeaking(true);

      source.onended = () => {
        activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
        if (activeSourcesRef.current.length === 0) {
          setIsSpeaking(false);
          lastAiSpeechEndRef.current = Date.now();
          // Ensure speech recognition is running after greeting or AI response completes
          if (!micStoppedByUserRef.current && isListeningRef.current && recognitionRef.current) {
            try {
              recognitionRef.current.start();
            } catch {}
          }
        }
      };
    } catch (e) {
      console.error('Error playing raw PCM chunk:', e);
    }
  };

  // Immediate barge-in cutoff
  const stopAllAudio = () => {
    lastAiSpeechEndRef.current = Date.now();
    activeSourcesRef.current.forEach(source => {
      try {
        source.stop();
        source.disconnect();
      } catch {}
    });
    activeSourcesRef.current = [];
    if (audioContextRef.current) {
      scheduledTimeRef.current = audioContextRef.current.currentTime;
    }
    setIsSpeaking(false);
  };

  // Connect to Gemini Live WebSocket
  const initGeminiLiveSession = async () => {
    try {
      const res = await fetch('/api/teach/voice/session?mode=assisted');
      const session = await res.json();
      if (!session.success || !session.apiKey) {
        console.warn('Could not acquire Gemini Live API key');
        return;
      }

      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }

      const wsUrl = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContent?key=${session.apiKey}`;
      const ws = new WebSocket(wsUrl);

      const gapsList = Array.isArray(session.knowledgeGaps) && session.knowledgeGaps.length > 0
        ? session.knowledgeGaps.map((g: string) => `- ${g}`).join('\n')
        : '- General hotel amenities and policies';

      const systemText = `ROLE: You are Krayn, hotel AI voice assistant.
GOAL: Chat simply with the hotel manager. Answer briefly using ONLY facts in HOTEL KNOWLEDGE. Proactively prompt the manager for answers using the CLARIFICATIONS HUB QUESTIONS below, one question at a time.

HOTEL KNOWLEDGE:
${session.currentKnowledge || '- General hotel operations active.'}

ACTIVE QUESTIONS FROM CLARIFICATIONS HUB:
${gapsList}

RULES FOR GUIDING & ASKING QUESTIONS:
1. PROMPT USING CLARIFICATIONS QUESTIONS:
   - Ask questions directly from the ACTIVE QUESTIONS FROM CLARIFICATIONS HUB list above.
   - Ask 1 clear question at a time. Never dump multiple questions.
2. HANDLING GREETING OR PROMPT REQUESTS:
   - When the user starts or asks "prompt me", "guide me", "what's next", or "ask me a question", immediately ask the first unanswered question from the Clarifications Hub.
3. INTELLIGENT PROBING ON CRITICAL DETAILS:
   - When the manager answers, if an essential sub-detail is missing (e.g. specific hours, prices, or conditions), ask 1 brief follow-up before moving to the next clarification question.
4. NEVER ASK ABOUT FACTS YOU ALREADY HAVE:
   - You have real-time access to HOTEL KNOWLEDGE. If an item or policy is already recorded, never ask about it.
5. STRICT GROUNDING: State only facts in HOTEL KNOWLEDGE.
6. MISSING FACTS: If the user asks about something not in HOTEL KNOWLEDGE, state clearly: "We don't have that on file yet. Could you share the details?"
7. SIMPLE & BRIEF: Plain conversational English. MAX 1 SHORT SENTENCE (under 16 words). No robotic filler.`;

      ws.onopen = () => {
        ws.send(
          JSON.stringify({
            setup: {
              model: session.model || 'models/gemini-2.5-flash-native-audio-latest',
              generationConfig: {
                responseModalities: ['AUDIO'],
                speechConfig: {
                  voiceConfig: {
                    prebuiltVoiceConfig: {
                      voiceName: session.voiceName || 'Charon',
                    },
                  },
                },
                thinkingConfig: {
                  thinkingBudget: 0,
                },
              },
              systemInstruction: {
                parts: [
                  {
                    text: systemText,
                  },
                ],
              },
            },
          })
        );
      };

      ws.onmessage = async (event) => {
        try {
          let rawText = '';
          if (typeof event.data === 'string') {
            rawText = event.data;
          } else if (event.data instanceof Blob) {
            rawText = await event.data.text();
          } else if (event.data instanceof ArrayBuffer) {
            rawText = new TextDecoder('utf-8').decode(event.data);
          } else {
            rawText = String(event.data);
          }

          const msg = JSON.parse(rawText);
          if (msg.setupComplete) {
            wsReadyRef.current = true;
            // If user clicked mic before setup completed, immediately fire greeting now!
            if (pendingGreetingPromptRef.current && wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              const promptToSend = pendingGreetingPromptRef.current;
              pendingGreetingPromptRef.current = null;
              setIsProcessing(true);
              wsRef.current.send(
                JSON.stringify({
                  clientContent: {
                    turns: [
                      {
                        role: 'user',
                        parts: [{ text: promptToSend }],
                      },
                    ],
                    turnComplete: true,
                  },
                })
              );
            }
          } else if (msg.serverContent) {
            // If the user has turned off the mic, ignore incoming server content completely
            if (!isListeningRef.current && !isPreparingMicRef.current) {
              return;
            }

            // Dismiss loading state immediately when any server content arrives
            if (awaitingFirstGreetingRef.current || isPreparingMicRef.current) {
              awaitingFirstGreetingRef.current = false;
              setIsPreparingMic(false);
              isListeningRef.current = true;
              setIsListening(true);
            }

            const parts = msg.serverContent.modelTurn?.parts || [];
            if (parts.length > 0) {
              setIsProcessing(false);
            }
            for (const part of parts) {
              if (part.inlineData && part.inlineData.mimeType?.startsWith('audio/pcm')) {
                if (isListeningRef.current) {
                  playPcmChunk(part.inlineData.data);
                }
              }
              if (part.text && !part.text.startsWith('**')) {
                currentAiUtteranceRef.current = (currentAiUtteranceRef.current + ' ' + part.text).trim();
                setHistory(prev => {
                  const last = prev[prev.length - 1];
                  if (last && last.role === 'ai') {
                    return [...prev.slice(0, -1), { role: 'ai', text: last.text + ' ' + part.text }];
                  }
                  return [...prev, { role: 'ai', text: part.text }];
                });
              }
            }
            if (msg.serverContent.turnComplete) {
              setIsProcessing(false);
            }
          }
        } catch (e) {
          console.error('Error handling Gemini Live message:', e);
        }
      };

      ws.onerror = (e) => {
        console.warn('Gemini Live WebSocket error:', e);
        wsReadyRef.current = false;
      };

      ws.onclose = () => {
        wsReadyRef.current = false;
      };

      wsRef.current = ws;
    } catch (e) {
      console.error('Failed to initialize Gemini Live session:', e);
    }
  };

  // Initialize Speech Recognition & Gemini Live on mount
  useEffect(() => {
    initGeminiLiveSession();

    let recognition: any = null;
    if (typeof window !== 'undefined') {
      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          if (micStoppedByUserRef.current || !isListeningRef.current) return;

          let currentInterim = '';
          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalChunk += event.results[i][0].transcript;
            } else {
              currentInterim += event.results[i][0].transcript;
            }
          }

          const rawCandidate = (finalChunk || currentInterim).trim();
          if (!rawCandidate) return;

          // If still in the warm-up phase, discard interim speech until ready
          if (isPreparingMicRef.current) return;

          // 1. Acoustic Echo / Bleed Protection:
          // Only discard if the microphone hears the AI's exact words during active AI speech output
          const now = Date.now();
          const isAiActive = isSpeakingRef.current || (now - lastAiSpeechEndRef.current < 400);
          if (isAiActive) {
            const cleanCandidate = rawCandidate.toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();
            const cleanAiUtterance = (currentAiUtteranceRef.current || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').trim();

            // Only filter out if the candidate actually echoes what the AI just spoke
            const isEcho = 
              (cleanAiUtterance && cleanAiUtterance.length > 5 && cleanCandidate.length > 3 && cleanAiUtterance.includes(cleanCandidate)) ||
              cleanCandidate === 'hi how can i help' ||
              cleanCandidate === 'what hotel policy';

            if (isEcho) {
              return;
            }
          }

          // Helper: check if a text fragment consists solely of filler/hesitation words
          const isFillerOnly = (text: string) => {
            const words = text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
            if (words.length === 0) return true;
            const fillers = new Set([
              'uh', 'uhh', 'uhhh', 'um', 'umm', 'ummm', 'err', 'er', 'ah', 'ahh', 'ahhh',
              'hmm', 'hm', 'hmmm'
            ]);
            return words.every(w => fillers.has(w));
          };

          // Helper: check if trailing words indicate user is currently thinking or formulating thought
          const endsWithHesitation = (text: string) => {
            const words = text.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
            if (words.length === 0) return false;
            const lastWord = words[words.length - 1];
            const hesitationWords = new Set([
              'uh', 'uhh', 'uhhh', 'um', 'umm', 'ummm', 'err', 'er', 'ah', 'ahh', 'ahhh',
              'hmm', 'hm', 'hmmm', 'and', 'but', 'or', 'so', 'because', 'with', 'for', 'if', 'when', 'that'
            ]);
            return hesitationWords.has(lastWord);
          };

          // If user makes an audible sound or interim utterance, keep visual indicator alive and reset silence timer
          setIsUserSpeaking(true);
          if (userSpeakingTimerRef.current) clearTimeout(userSpeakingTimerRef.current);
          userSpeakingTimerRef.current = setTimeout(() => {
            setIsUserSpeaking(false);
          }, 800);

          // If AI is currently speaking and user intentionally speaks a real substantive phrase, barge-in!
          if (isSpeakingRef.current && rawCandidate.length > 3 && !isFillerOnly(rawCandidate)) {
            stopAllAudio();
          }

          if (finalChunk.trim()) {
            transcriptBufferRef.current = transcriptBufferRef.current
              ? `${transcriptBufferRef.current} ${finalChunk.trim()}`
              : finalChunk.trim();

            const accumulated = transcriptBufferRef.current.trim();

            // If the user has ONLY said hesitation words like "uh", "umm", "err", DO NOT send to AI!
            if (isFillerOnly(accumulated)) {
              if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
              return;
            }

            // Adaptive pause duration:
            // - If the sentence ends with a hesitation word ("...um", "...uh", "...and"), give 1200ms to allow them to continue.
            // - For standard finished speech, dispatch quickly after 650ms for instantaneous conversational interaction.
            const isUnfinished = endsWithHesitation(accumulated);
            const pauseTimeout = isUnfinished ? 1200 : 650;

            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              setIsUserSpeaking(false);
              handleUserSpeechDone();
            }, pauseTimeout);
          } else if (currentInterim.trim()) {
            // User is actively speaking interim words; extend pause
            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            const interimCandidate = currentInterim.trim();
            if (!isFillerOnly(interimCandidate)) {
              // Set fallback timer in case browser does not fire isFinal promptly
              silenceTimerRef.current = setTimeout(() => {
                if (!transcriptBufferRef.current && interimCandidate) {
                  transcriptBufferRef.current = interimCandidate;
                }
                setIsUserSpeaking(false);
                handleUserSpeechDone();
              }, 950);
            }
          }
        };

        recognition.onerror = (event: any) => {
          console.warn('[Voice Recognition Error]:', event.error);
          if (event.error === 'not-allowed') {
            setMicError('Microphone permission denied. Please allow microphone access in your browser.');
            setIsListening(false);
          }
        };

        recognition.onend = () => {
          if (!micStoppedByUserRef.current && isListeningRef.current) {
            try {
              recognition.start();
            } catch {}
          }
        };

        recognitionRef.current = recognition;
        setIsListening(false);
      } else {
        setMicError('Web Speech Recognition is not supported in this browser. Please use Google Chrome or Safari.');
      }
    }

    return () => {
      if (recognition) {
        try {
          recognition.stop();
        } catch {}
      }
      stopAllAudio();
      if (wsRef.current) {
        try {
          wsRef.current.close();
        } catch {}
      }
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
      }

      const currentHistory = historyRef.current;
      if (currentHistory.length > 0) {
        try {
          fetch('/api/teach/voice/end', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ history: currentHistory }),
            keepalive: true,
          }).catch(err => console.error('Voice end sync error:', err));
        } catch (e) {}
      }
    };
  }, []);

  const handleUserSpeechDone = async () => {
    const textToSend = transcriptBufferRef.current.trim();
    transcriptBufferRef.current = '';
    if (!textToSend) return;

    processSpeechInput(textToSend);
  };

  const processSpeechInput = async (spokenText: string) => {
    if (!spokenText.trim()) return;

    ensureAudioContext();
    setIsProcessing(true);
    currentAiUtteranceRef.current = '';

    const updatedHistory = [...historyRef.current, { role: 'user' as const, text: spokenText }];
    setHistory(updatedHistory);

    // Check if the user's speech seems clearly unfinished (ends in hesitation words, conjunctions, or prepositions)
    const words = spokenText.toLowerCase().trim().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
    const lastWord = words.length > 0 ? words[words.length - 1] : '';
    const incompleteEndings = new Set([
      'uh', 'uhh', 'uhhh', 'um', 'umm', 'ummm', 'err', 'er', 'ah', 'ahh', 'ahhh',
      'hmm', 'hm', 'hmmm', 'and', 'but', 'or', 'so', 'because', 'with', 'for', 'if', 'when', 'that', 'the', 'a', 'an'
    ]);
    const isClearlyIncomplete = incompleteEndings.has(lastWord);

    // 1. Send to Gemini Live WebSocket for zero-latency neural male speech
    if (wsRef.current && wsReadyRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      const payloadText = isClearlyIncomplete
        ? `${spokenText} [Note: User trailed off or stopped mid-sentence. Do not invent facts or assume. Briefly and gently check in with them to help them finish, e.g. "Take your time. What was the rest of that policy?" or "Did you want to finish that thought?"]`
        : spokenText;

      wsRef.current.send(
        JSON.stringify({
          clientContent: {
            turns: [
              {
                role: 'user',
                parts: [{ text: payloadText }],
              },
            ],
            turnComplete: true,
          },
        })
      );
    } else {
      // If WebSocket is not ready, re-initialize immediately
      initGeminiLiveSession();
    }

    // 2. Send in parallel to backend for reliable rule extraction and persistence
    try {
      const res = await fetch('/api/teach/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speechText: spokenText,
          history: updatedHistory,
          mode: 'assisted',
        }),
      });

      const data = await res.json();
      if (data.success && data.learnedFact?.topic && data.learnedFact?.detail) {
        const newFact = data.learnedFact;
        const normNewTopic = newFact.topic.toLowerCase().replace(/[^a-z0-9]/g, '');

        setLearnedRules(prev => {
          // Check if an existing rule in the current list shares the same topic or overlaps
          const existingIdx = prev.findIndex(item => {
            const normExisting = item.topic.toLowerCase().replace(/[^a-z0-9]/g, '');
            return normExisting === normNewTopic ||
              (normExisting.includes('luggage') && normNewTopic.includes('luggage')) ||
              (normExisting.includes('checkout') && normNewTopic.includes('checkout')) ||
              (normExisting.includes('checkin') && normNewTopic.includes('checkin')) ||
              (normExisting.includes('amenit') && normNewTopic.includes('amenit'));
          });

          if (existingIdx !== -1) {
            // Update in-place with the latest authoritative, clean rule (do not concatenate duplicates)
            const updated = [...prev];
            updated[existingIdx] = {
              ...updated[existingIdx],
              topic: newFact.topic,
              detail: newFact.detail,
            };
            return updated;
          }

          // Otherwise add new rule to top
          return [
            {
              id: newFact.id || `fact_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
              topic: newFact.topic,
              detail: newFact.detail,
              timestamp: new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
            },
            ...prev,
          ];
        });
      }
    } catch (e) {
      console.error('Knowledge extraction error:', e);
    }
  };

  const startVoice = () => {
    // If already preparing or listening, do nothing
    if (isPreparingMic || isListening) return;

    micStoppedByUserRef.current = false;

    // 1. Immediately pre-warm Web Audio
    const ctx = ensureAudioContext();
    if (ctx && ctx.state === 'suspended') {
      ctx.resume().catch(() => {});
    }

    // 2. Clear conversation history and reset greeting flags for a completely new, fresh session
    setHistory([]);
    historyRef.current = [];
    currentAiUtteranceRef.current = '';
    transcriptBufferRef.current = '';
    hasGreetedRef.current = false;
    awaitingFirstGreetingRef.current = true;

    // 3. Re-initialize a fresh Gemini Live WebSocket session every time mic turns on
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    wsReadyRef.current = false;
    initGeminiLiveSession();

    // 4. Mark listening intent; speech recognition will activate cleanly once the greeting completes
    isListeningRef.current = true;

    // 5. Set loading state: keep loading until the agent begins greeting!
    setIsPreparingMic(true);
    setMicError(null);

    // Natural greetings: always greet the person first when starting a fresh session
    const greetingOptions = [
      'Say strictly and concisely: "Hi! Would you like me to prompt you on missing policies, or do you have something to add?"',
      'Say strictly and concisely: "Hello! Should we review missing hotel policies together, or is there something specific you would like to add?"',
      'Say strictly and concisely: "Hi there! Would you like me to guide you through missing details, or do you have rules to update?"',
      'Say strictly and concisely: "Hello! Shall I ask about our missing hotel policies, or feel free to tell me what you want to add."',
    ];
    const greetingPrompt = greetingOptions[Math.floor(Math.random() * greetingOptions.length)];

    // Queue greeting prompt to immediately dispatch the instant setupComplete arrives on the new connection
    pendingGreetingPromptRef.current = greetingPrompt;

    // Safety fallback: Never keep user stuck on loading spinner for more than 4 seconds under any network circumstance
    if (micSafetyTimeoutRef.current) clearTimeout(micSafetyTimeoutRef.current);
    micSafetyTimeoutRef.current = setTimeout(() => {
      if (isPreparingMicRef.current && !micStoppedByUserRef.current) {
        isPreparingMicRef.current = false;
        awaitingFirstGreetingRef.current = false;
        setIsPreparingMic(false);
        setIsListening(true);
      }
    }, 4000);
  };

  const stopVoice = () => {
    // 1. Immediately mark mic as explicitly stopped by user
    micStoppedByUserRef.current = true;
    isListeningRef.current = false;
    isPreparingMicRef.current = false;
    awaitingFirstGreetingRef.current = false;
    pendingGreetingPromptRef.current = null;
    transcriptBufferRef.current = '';

    setIsListening(false);
    setIsPreparingMic(false);
    setIsUserSpeaking(false);
    setIsProcessing(false);

    // 2. Clear all active timeouts
    if (micSafetyTimeoutRef.current) {
      clearTimeout(micSafetyTimeoutRef.current);
      micSafetyTimeoutRef.current = null;
    }
    if (micWarmupTimeoutRef.current) {
      clearTimeout(micWarmupTimeoutRef.current);
      micWarmupTimeoutRef.current = null;
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
      silenceTimerRef.current = null;
    }
    if (userSpeakingTimerRef.current) {
      clearTimeout(userSpeakingTimerRef.current);
      userSpeakingTimerRef.current = null;
    }

    // 3. Immediately halt speech recognition
    if (recognitionRef.current) {
      try {
        recognitionRef.current.abort();
      } catch {}
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    // 4. Forcefully stop all playing audio and reset audio scheduler clock
    stopAllAudio();
    scheduledTimeRef.current = 0;
    currentAiUtteranceRef.current = '';

    // 5. Hard close and reset the Gemini Live WebSocket session so the server drops the conversation context
    if (wsRef.current) {
      try {
        wsRef.current.close();
      } catch {}
      wsRef.current = null;
    }
    wsReadyRef.current = false;

    // 6. Reset greeting and conversation history for a completely fresh start when mic turns on again
    hasGreetedRef.current = false;
    setHistory([]);
    historyRef.current = [];
  };

  const toggleMute = () => {
    if (isSpeaking) {
      stopAllAudio();
    }
    setIsMuted(prev => !prev);
  };

  const handleManualSaveSession = async () => {
    if (history.length === 0 || isSyncingKnowledge) return;
    setIsSyncingKnowledge(true);
    try {
      const res = await fetch('/api/teach/voice/end', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ history }),
      });
      const data = await res.json();
      if (data.success) {
        setSyncedCount(data.count ?? 0);
        setTimeout(() => setSyncedCount(null), 4000);
      }
    } catch (e) {
      console.error('Failed to sync session knowledge:', e);
    } finally {
      setIsSyncingKnowledge(false);
    }
  };

  const handleDeleteRule = (ruleId?: string, idx?: number) => {
    setLearnedRules(prev => prev.filter((r, i) => (ruleId ? r.id !== ruleId : i !== idx)));
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden text-[#1D1D1F]">
      <Sidebar />

      <main className="flex-1 flex flex-col h-full bg-white relative overflow-hidden">
        {/* Full-Screen Scrollable View formatted precisely to Clarifications Page design */}
        <div className="flex-1 overflow-y-auto w-full p-4 sm:p-6 lg:p-7 space-y-6">


          {/* Sync notification banner */}
          <AnimatePresence>
            {syncedCount !== null && (
              <motion.div
                initial={{ opacity: 0, y: -8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                className="p-3 rounded-xl bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs font-semibold flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                  <span>
                    Indexed {syncedCount} operational {syncedCount === 1 ? 'rule' : 'rules'} into Knowledge memory.
                  </span>
                </div>
                <Link
                  href="/knowledge"
                  className="text-emerald-900 underline hover:no-underline font-bold flex items-center gap-1"
                >
                  View in Knowledge <ArrowRight className="w-3 h-3" />
                </Link>
              </motion.div>
            )}
          </AnimatePresence>

          {/* 2-Column Responsive Layout: Left = Conversational Voice Orb | Right = Live Learned Knowledge Table */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 w-full items-stretch">
            {/* Left Column: Voice Interactive Orb Canvas */}
            <div className="lg:col-span-5 xl:col-span-5 rounded-2xl border border-gray-200/90 bg-white p-6 sm:p-8 shadow-none flex flex-col items-center justify-center h-[520px] relative overflow-hidden">

              {/* Main Interactive Center Column */}
              <div className="flex flex-col items-center justify-center my-auto">
                
                {/* Unified Orb & Sound Wave Anchor: All effects centered directly to the mic circle */}
                <div className="relative w-36 h-36 flex items-center justify-center">

                  {/* Crisp, clearly visible concentric pulsing rings strictly while speaking or user speaking */}
                  {(isSpeaking || isUserSpeaking) && (
                    <>
                      {/* Ripple 1: Crisp primary sound ring */}
                      <div
                        className={`absolute inset-0 rounded-full border-2 pointer-events-none animate-ping ${
                          isUserSpeaking ? 'border-red-500/80' : 'border-orange-500/80'
                        }`}
                        style={{ animationDuration: '1.2s' }}
                      />

                      {/* Ripple 2: Secondary harmonic ring for rich visual depth */}
                      <div
                        className={`absolute inset-0 rounded-full border pointer-events-none animate-ping ${
                          isUserSpeaking ? 'border-red-400/60' : 'border-orange-400/60'
                        }`}
                        style={{ animationDuration: '1.2s', animationDelay: '0.4s' }}
                      />
                    </>
                  )}

                  {/* Core Mic Button Circle (Stable, perfectly centered without displacement) */}
                  <div
                    className={`w-36 h-36 rounded-full flex items-center justify-center shadow-lg transition-colors duration-300 relative cursor-pointer z-10 ${
                      isPreparingMic
                        ? 'bg-gradient-to-tr from-orange-400 to-red-500 shadow-orange-500/35 ring-4 ring-orange-500/25'
                        : isUserSpeaking
                        ? 'bg-gradient-to-tr from-red-600 via-orange-500 to-red-500 shadow-red-500/40 ring-4 ring-red-500/30'
                        : isSpeaking
                        ? 'bg-gradient-to-tr from-orange-500 to-red-500 shadow-orange-500/35 ring-4 ring-orange-500/25'
                        : isListening || isProcessing
                        ? 'bg-gradient-to-tr from-orange-500 to-red-400 shadow-orange-500/25 ring-2 ring-orange-500/20'
                        : 'bg-gradient-to-tr from-gray-200 to-gray-300 shadow-black/5 ring-0'
                    }`}
                    onClick={() => {
                      if (isPreparingMic || isListening) stopVoice();
                      else startVoice();
                    }}
                  >
                    <div className="w-32 h-32 rounded-full bg-white flex flex-col items-center justify-center relative shadow-inner">
                      {isPreparingMic ? (
                        <div className="flex flex-col items-center justify-center animate-fade-in">
                          <motion.div
                            animate={{ rotate: 360 }}
                            transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
                            className="w-10 h-10 border-2 border-orange-200 border-t-[#FF751F] rounded-full"
                          />
                        </div>
                      ) : isListening || isSpeaking || isProcessing || isUserSpeaking ? (
                        <Mic className={`w-12 h-12 transition-colors duration-300 select-none pointer-events-none transform-none ${
                          isUserSpeaking ? 'text-red-500' : 'text-orange-500'
                        }`} />
                      ) : (
                        <MicOff className="w-12 h-12 text-gray-400 select-none pointer-events-none transform-none" />
                      )}
                    </div>
                  </div>
                </div>
              </div>

              {micError && (
                <div className="absolute bottom-4 left-6 right-6 px-4 py-2 rounded-xl bg-red-50 border border-red-200 text-xs text-red-700 flex items-center justify-center gap-2 z-20">
                  <AlertCircle className="w-4 h-4 shrink-0 text-red-500" />
                  <span>{micError}</span>
                </div>
              )}
            </div>

            {/* Right Column: Learned Knowledge Card with matched equal height */}
            <div className="lg:col-span-7 xl:col-span-7 rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none h-[520px] flex flex-col">
              {/* Title matching Knowledge Hub design style (bold uppercase, count pill, orange underline, no gray border-b divider) */}
              <div className="px-6 pt-5 pb-2 flex items-center justify-between">
                <div className="inline-flex items-center gap-2 pb-1 border-b-2 border-[#FF751F]">
                  <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                    Learned from Conversation
                  </h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                    {learnedRules.length}
                  </span>
                </div>
              </div>

              {/* Rows matching Knowledge Hub */}
              <div className="flex-1 divide-y divide-gray-100 px-6 overflow-y-auto">
                {learnedRules.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-center p-8 text-gray-400 my-auto">
                    <p className="text-xs font-semibold text-gray-600">No knowledge points captured yet</p>
                  </div>
                ) : (
                  learnedRules.map((rule, idx) => (
                    <motion.div
                      key={rule.id || idx}
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      className="w-full py-4 group transition-colors"
                    >
                      <div className="grid grid-cols-12 gap-3 items-start">
                        {/* Column 1: Topic */}
                        <div className="col-span-4 sm:col-span-4 pr-2">
                          <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                            {rule.topic}
                          </span>
                        </div>

                        {/* Column 2: Detail */}
                        <div className="col-span-7 sm:col-span-7 pr-2">
                          <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                            {rule.detail}
                          </p>
                        </div>

                        {/* Action (trash button) */}
                        <div className="col-span-1 sm:col-span-1 flex items-center justify-end">
                          <button
                            type="button"
                            onClick={() => handleDeleteRule(rule.id, idx)}
                            className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition cursor-pointer"
                            title="Discard rule"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  ))
                )}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
