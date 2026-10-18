'use client';

import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  Mic,
  MicOff,
  X,
  Volume2,
  VolumeX,
  Sparkles,
  AlertCircle
} from 'lucide-react';

interface VoiceTeachModalProps {
  isOpen: boolean;
  onClose: () => void;
  onFactTaught?: () => void;
}

export default function VoiceTeachModal({ isOpen, onClose, onFactTaught }: VoiceTeachModalProps) {
  const [isListening, setIsListening] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [history, setHistory] = useState<Array<{ role: 'user' | 'ai'; text: string }>>([]);
  const [micError, setMicError] = useState<string | null>(null);
  const [isSyncingKnowledge, setIsSyncingKnowledge] = useState(false);

  const recognitionRef = useRef<any>(null);
  const synthRef = useRef<SpeechSynthesis | null>(null);
  const silenceTimerRef = useRef<NodeJS.Timeout | null>(null);
  const isSpeakingRef = useRef(false);
  const transcriptBufferRef = useRef<string>('');
  const historyRef = useRef<Array<{ role: 'user' | 'ai'; text: string }>>([]);

  isSpeakingRef.current = isSpeaking;
  historyRef.current = history;

  // Handle closing session: trigger background batch indexing of learned facts
  const handleCloseSession = async () => {
    stopVoice();

    const currentHistory = historyRef.current;
    if (currentHistory.length > 0) {
      setIsSyncingKnowledge(true);
      try {
        fetch('/api/teach/voice/end', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ history: currentHistory }),
        })
          .then(res => res.json())
          .then(data => {
            if (data.success && onFactTaught) {
              onFactTaught();
            }
          })
          .catch(err => {
            console.error('Error during voice end indexing:', err);
          });
      } catch (err) {
        console.error('Failed to trigger voice knowledge indexing:', err);
      }
    }

    onClose();
  };

  // Initialize Speech Recognition & Synthesis on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      synthRef.current = window.speechSynthesis;
      if (synthRef.current) {
        synthRef.current.getVoices();
        synthRef.current.onvoiceschanged = () => {
          synthRef.current?.getVoices();
        };
      }

      const SpeechRecognition =
        (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;

      if (SpeechRecognition) {
        const recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
        recognition.lang = 'en-US';

        recognition.onresult = (event: any) => {
          if (isSpeakingRef.current) return;

          let finalChunk = '';

          for (let i = event.resultIndex; i < event.results.length; ++i) {
            if (event.results[i].isFinal) {
              finalChunk += event.results[i][0].transcript;
            }
          }

          if (finalChunk.trim()) {
            transcriptBufferRef.current = transcriptBufferRef.current
              ? `${transcriptBufferRef.current} ${finalChunk.trim()}`
              : finalChunk.trim();

            if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
            silenceTimerRef.current = setTimeout(() => {
              handleUserSpeechDone();
            }, 600);
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
          if (isOpen && isListening && !isSpeakingRef.current) {
            try {
              recognition.start();
            } catch {}
          }
        };

        recognitionRef.current = recognition;
      } else {
        setMicError('Web Speech Recognition is not supported in this browser. Please use Google Chrome or Safari.');
      }
    }

    return () => {
      stopVoice();
    };
  }, [isOpen]);

  // Reset state when modal opens/closes
  useEffect(() => {
    if (isOpen) {
      transcriptBufferRef.current = '';
      setHistory([]);
      setMicError(null);
      setIsListening(false);
    } else {
      stopVoice();
    }
  }, [isOpen]);

  const startVoice = () => {
    if (!recognitionRef.current) return;
    try {
      recognitionRef.current.start();
      setIsListening(true);
      setMicError(null);
    } catch {
      setIsListening(true);
    }
  };

  const stopVoice = () => {
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }
    if (synthRef.current) {
      synthRef.current.cancel();
    }
    if (silenceTimerRef.current) {
      clearTimeout(silenceTimerRef.current);
    }
    setIsListening(false);
    setIsSpeaking(false);
  };

  const handleUserSpeechDone = async () => {
    const textToSend = transcriptBufferRef.current.trim();
    transcriptBufferRef.current = '';
    if (!textToSend) return;

    processSpeechInput(textToSend);
  };

  const processSpeechInput = async (spokenText: string) => {
    if (!spokenText.trim() || isProcessing) return;

    setIsProcessing(true);
    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    const updatedHistory = [...historyRef.current, { role: 'user' as const, text: spokenText }];
    setHistory(updatedHistory);

    try {
      const res = await fetch('/api/teach/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          speechText: spokenText,
          history: updatedHistory,
        }),
      });

      const data = await res.json();

      if (data.success) {
        const reply = data.spokenReply || `I understand. What other policies or details can I record?`;
        setHistory(prev => [...prev, { role: 'ai' as const, text: reply }]);
        speakText(reply);
      } else {
        const errorReply = `I didn't quite catch that. Could you say that once more?`;
        speakText(errorReply);
      }
    } catch (err) {
      console.error('Voice process error:', err);
      const fallbackReply = `Understood. Please go ahead.`;
      speakText(fallbackReply);
    } finally {
      setIsProcessing(false);
    }
  };

  const speakText = (text: string) => {
    if (!synthRef.current || isMuted) {
      resumeListening();
      return;
    }

    if (recognitionRef.current) {
      try {
        recognitionRef.current.stop();
      } catch {}
    }

    synthRef.current.cancel();

    const cleanText = text.replace(/[*#_~`]/g, '').trim();
    const utterance = new SpeechSynthesisUtterance(cleanText);
    utterance.rate = 1.05;
    utterance.pitch = 1.0;

    const voices = synthRef.current.getVoices();
    const naturalVoice = voices.find(
      v =>
        (v.name.includes('Natural') ||
          v.name.includes('Google') ||
          v.name.includes('Samantha') ||
          v.name.includes('Karen') ||
          v.name.includes('Daniel') ||
          v.name.includes('Jenny') ||
          v.name.includes('Guy')) &&
        v.lang.startsWith('en')
    );
    if (naturalVoice) utterance.voice = naturalVoice;

    let heartbeatTimer: any = null;

    utterance.onstart = () => {
      setIsSpeaking(true);
      heartbeatTimer = setInterval(() => {
        if (synthRef.current?.speaking) {
          synthRef.current.pause();
          synthRef.current.resume();
        }
      }, 5000);
    };

    const handleSpeechFinished = () => {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      setIsSpeaking(false);
      setTimeout(() => {
        resumeListening();
      }, 200);
    };

    utterance.onend = handleSpeechFinished;
    utterance.onerror = handleSpeechFinished;

    synthRef.current.speak(utterance);
  };

  const resumeListening = () => {
    if (isOpen && recognitionRef.current) {
      try {
        recognitionRef.current.start();
        setIsListening(true);
      } catch {}
    }
  };

  const toggleMute = () => {
    if (isSpeaking && synthRef.current) {
      synthRef.current.cancel();
      setIsSpeaking(false);
    }
    setIsMuted(prev => !prev);
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-xl p-4"
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0.95, opacity: 0 }}
          transition={{ type: 'spring', damping: 25, stiffness: 300 }}
          className="relative w-full max-w-lg h-[480px] bg-gradient-to-b from-[#18181B] to-[#09090B] border border-white/10 rounded-3xl shadow-2xl flex flex-col overflow-hidden text-white"
        >
          {/* Top Bar: Minimal Status & Close */}
          <div className="flex items-center justify-between px-6 py-5 border-b border-white/5 shrink-0">
            <div className="flex items-center gap-2.5">
              <span className="flex h-2.5 w-2.5 relative">
                <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${isSpeaking ? 'bg-indigo-400' : isListening ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${isSpeaking ? 'bg-indigo-500' : isListening ? 'bg-emerald-500' : 'bg-amber-500'}`} />
              </span>
              <span className="text-xs font-medium tracking-wider uppercase text-white/60">
                {isProcessing ? 'Thinking...' : isSpeaking ? 'Speaking' : isListening ? 'Listening' : 'Ready'}
              </span>
            </div>

            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={toggleMute}
                className="p-2.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
                title={isMuted ? 'Unmute AI Voice' : 'Mute AI Voice'}
              >
                {isMuted ? <VolumeX className="w-4 h-4 text-red-400" /> : <Volume2 className="w-4 h-4" />}
              </button>

              <button
                type="button"
                onClick={handleCloseSession}
                className="p-2.5 rounded-full hover:bg-white/10 text-white/70 hover:text-white transition-all cursor-pointer"
                title="Close Voice Session"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Center Stage: Apple Intelligence Orb (No Captions, Pure Real-Time Spoken Flow) */}
          <div className="flex-1 flex flex-col items-center justify-center p-8 text-center relative overflow-hidden">
            {/* Ambient Dynamic Glow */}
            <div
              className={`absolute w-80 h-80 rounded-full blur-3xl transition-all duration-700 pointer-events-none ${
                isSpeaking
                  ? 'bg-orange-500/30 scale-125'
                  : isProcessing
                  ? 'bg-amber-500/25 scale-115'
                  : isListening
                  ? 'bg-orange-500/25 scale-110'
                  : 'bg-white/5 scale-90'
              }`}
            />

            {/* Siri / Apple Style Animated Orb */}
            <div className="relative mb-8">
              <motion.div
                animate={{
                  scale: (isSpeaking || isListening || isProcessing) ? [1, 1.06, 1] : 1,
                }}
                transition={{
                  duration: isSpeaking ? 2.0 : isListening ? 2.5 : 3.0,
                  repeat: Infinity,
                  ease: [0.42, 0, 0.58, 1],
                }}
                className={`w-36 h-36 rounded-full flex items-center justify-center shadow-2xl transition-all duration-700 relative cursor-pointer ${
                  isListening || isSpeaking || isProcessing
                    ? 'bg-gradient-to-tr from-[#FF751F] via-orange-400 to-amber-400 shadow-orange-500/40'
                    : 'bg-gradient-to-tr from-gray-700 to-gray-900 shadow-black'
                }`}
                onClick={() => {
                  if (isListening) stopVoice();
                  else startVoice();
                }}
              >
                <div className="w-32 h-32 rounded-full bg-black/40 backdrop-blur-md flex items-center justify-center">
                  {isListening || isSpeaking || isProcessing ? (
                    <Mic className="w-12 h-12 text-[#FF751F] select-none pointer-events-none transform-none" />
                  ) : (
                    <MicOff className="w-12 h-12 text-white/50 select-none pointer-events-none transform-none" />
                  )}
                </div>
              </motion.div>
            </div>

            {/* Clean Status Pill */}
            <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/5 border border-white/10 text-xs text-white/70">
              <span className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-orange-400 animate-ping' : isProcessing ? 'bg-amber-400 animate-pulse' : isListening ? 'bg-orange-400 animate-pulse' : 'bg-gray-500'}`} />
              <span className="font-medium tracking-wide">
                {isSpeaking ? 'Speaking...' : isProcessing ? 'Thinking...' : isListening ? 'Listening...' : 'Tap orb to start'}
              </span>
            </div>

            {micError && (
              <div className="mt-4 px-4 py-2 rounded-xl bg-red-500/20 border border-red-500/40 text-xs text-red-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 shrink-0" />
                <span>{micError}</span>
              </div>
            )}
          </div>

          {/* Minimal Apple-style Footer */}
          <div className="px-6 py-4 bg-black/40 border-t border-white/5 flex items-center justify-center text-xs text-white/40 shrink-0">
            <span className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-[#FF751F]" />
              Learnings are indexed automatically when you close this session
            </span>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>
  );
}
