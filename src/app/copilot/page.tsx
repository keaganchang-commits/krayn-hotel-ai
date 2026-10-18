'use client';

import React, { useState, useEffect, useRef } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  PhoneCall,
  PhoneOff,
  PhoneForwarded,
  Sparkles,
  Calendar,
  CheckCircle2,
  Clock,
  User,
  Building,
  FileText,
  AlertTriangle,
  AlertCircle,
  Play,
  Pause,
  RotateCcw,
  Volume2,
  VolumeX,
  Send,
  ArrowRight,
  ShieldCheck,
  Check,
  TrendingUp,
  Baby,
  Coffee,
  Bed,
  MapPin,
  ExternalLink,
  Loader2,
  Receipt
} from 'lucide-react';

interface DialogTurn {
  speaker: 'caller' | 'agent';
  speakerName: string;
  text: string;
  timestamp: string;
  detectedIntent?: string;
  sentiment?: 'positive' | 'neutral' | 'urgent';
  suggestedPrompt?: string;
  highlightFact?: string;
  suggestedAsset?: {
    name: string;
    type: string;
  };
}

interface Scenario {
  id: string;
  callerName: string;
  callerTitle: string;
  callerPhone: string;
  callerCompany?: string;
  vipTier: 'Gold' | 'Silver' | 'Bronze' | 'Globalist VIP';
  callTitle: string;
  crmInsight: string;
  audioDuration: string;
  dialogue: DialogTurn[];
  autonomousAction: {
    title: string;
    description: string;
    actionType: 'calendar_and_proposal' | 'housekeeping_and_crib' | 'dining_and_allergy' | 'spa_booking';
    details: Record<string, any>;
    tasks: string[];
  };
}

const SCENARIOS: Scenario[] = [
  {
    id: 'spa',
    callerName: 'Priya Sharma',
    callerTitle: 'In-House Guest (Suite #1802)',
    callerCompany: 'Park Hyatt Kuala Lumpur',
    callerPhone: '+60 12-345 6789',
    vipTier: 'Gold',
    callTitle: 'Park Hyatt Spa 60-Minute Massage Reservation',
    crmInsight: 'Gold VIP guest staying in Suite 1802. Severe nut allergy on record (almond oil prohibited). Requires 100% organic lavender oil and firm pressure deep tissue massage.',
    audioDuration: '0:26',
    dialogue: [
      {
        speaker: 'caller',
        speakerName: 'Priya Sharma',
        text: 'Hi, good afternoon! I’d like to book a 60-minute massage at the spa for tomorrow at 3 PM. Do you have slots open?',
        timestamp: '00:04',
        detectedIntent: 'Spa Treatment Booking (60-Min Massage, 3:00 PM Tomorrow)',
        suggestedPrompt: 'Confirm 60-minute signature deep tissue massage availability at 3:00 PM. Note Priya Sharma’s nut allergy (nut-free organic lavender oil).',
        highlightFact: 'Park Hyatt Spa: Level 102 Wellness Sanctuary. Signature Deep Tissue 60 mins (RM 480). Slot available at 3:00 PM with senior female therapist (Siti).',
        suggestedAsset: { name: 'Park_Hyatt_Spa_Wellness_Menu.pdf', type: 'PDF' },
      },
      {
        speaker: 'agent',
        speakerName: 'James (Concierge)',
        text: 'Good afternoon, Ms. Sharma. Let me check... uhm, yes, our signature deep massage is available with our senior female therapist.',
        timestamp: '00:12',
      },
      {
        speaker: 'caller',
        speakerName: 'Priya Sharma',
        text: 'Wonderful, please reserve that for me and charge it to room 1802.',
        timestamp: '00:19',
        detectedIntent: 'Confirm Spa Booking & Charge to Suite #1802',
        suggestedPrompt: 'Confirm reservation, tag room bill (RM 480 net), and note nut-free lavender oil.',
        highlightFact: 'Guest Verified: Priya Sharma (Suite 1802). Room charge authorized. Nut-free protocol confirmed.',
      },
      {
        speaker: 'agent',
        speakerName: 'James (Concierge)',
        text: 'Of course! I’ve booked your 3:00 PM appointment and will send you confirmation on WhatsApp.',
        timestamp: '00:26',
      },
    ],
    autonomousAction: {
      title: 'Confirm Spa Treatment & Charge to Suite #1802',
      description: 'Book Treatment Suite 4 in Spa PMS, bill RM 480 to Suite #1802, and dispatch WhatsApp confirmation pass.',
      actionType: 'spa_booking',
      details: {
        treatment: '60-Minute Signature Deep Tissue Massage',
        time: 'Tomorrow, 3:00 PM – 4:00 PM',
        roomNumber: '1802',
        suite: 'Diplomatic Suite',
        venue: 'Park Hyatt Spa (Level 102, Suite 4)',
        therapist: 'Senior Certified Therapist (Siti)',
        price: '480',
        oilPreference: 'Nut-Free Organic Lavender',
        phone: '+60 12-345 6789',
      },
      tasks: [
        'Spa POS System: Book 60-min Deep Tissue in Treatment Suite 4 (Tomorrow 3:00 PM)',
        'Opera PMS: Post RM 480 + 8% SST treatment charge to Suite #1802',
        'Dietary / Allergy Flag: Nut-free protocol strictly enforced (almond oil substituted with organic lavender)',
        'Dispatch Instant WhatsApp Confirmation Card to +60 12-345 6789',
      ],
    },
  },
];

export default function CopilotPage() {
  const scenario = SCENARIOS[0];
  const [hasCallStarted, setHasCallStarted] = useState<boolean>(false);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [isAudioMuted, setIsAudioMuted] = useState<boolean>(false);
  const [currentTurnIndex, setCurrentTurnIndex] = useState<number>(0);
  const [callElapsedSeconds, setCallElapsedSeconds] = useState<number>(0);
  const [isExecutingAction, setIsExecutingAction] = useState<boolean>(false);
  const [actionResult, setActionResult] = useState<any | null>(null);
  const [currentSpeaker, setCurrentSpeaker] = useState<'caller' | 'agent' | null>(null);
  const [showTherapistAlert, setShowTherapistAlert] = useState<boolean>(false);
  const [calendarSearchState, setCalendarSearchState] = useState<'idle' | 'searching' | 'ready'>('idle');
  const [whatsappActionState, setWhatsappActionState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [billingActionState, setBillingActionState] = useState<'idle' | 'adding' | 'added'>('idle');
  const [visibleWordCount, setVisibleWordCount] = useState<number>(0);
  const dialogueEndRef = useRef<HTMLDivElement>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const gainNodeRef = useRef<GainNode | null>(null);
  const activeSourcesRef = useRef<AudioBufferSourceNode[]>([]);
  const cachedAudioBuffersRef = useRef<Map<number, AudioBuffer>>(new Map());
  const isFetchingAudioRef = useRef<Set<number>>(new Set());
  const turnStartTimeRef = useRef<number>(0);
  const turnPauseOffsetRef = useRef<number>(0);
  const activeTurnIndexRef = useRef<number>(-1);
  const isTurnPlayingRef = useRef<boolean>(false);
  const calendarSpinnerTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  // Ensure AudioContext and GainNode are ready
  const getAudioContext = () => {
    if (!audioContextRef.current) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        audioContextRef.current = new AudioCtx({ sampleRate: 24000 });
        const gain = audioContextRef.current.createGain();
        gain.gain.value = isAudioMuted ? 0 : 1;
        gain.connect(audioContextRef.current.destination);
        gainNodeRef.current = gain;
      }
    }
    return audioContextRef.current;
  };

  // Toggle mute state dynamically on running audio
  const handleToggleMute = () => {
    setIsAudioMuted(prev => {
      const nextMuted = !prev;
      if (gainNodeRef.current && audioContextRef.current) {
        gainNodeRef.current.gain.setValueAtTime(nextMuted ? 0 : 1, audioContextRef.current.currentTime);
      }
      return nextMuted;
    });
  };

  // Stop currently playing PCM audio
  const stopPcmAudio = () => {
    activeSourcesRef.current.forEach(src => {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {}
    });
    activeSourcesRef.current = [];
  };

  // Convert Base64 raw linear PCM (24kHz, 16-bit) to AudioBuffer
  const decodePcmBuffer = (base64Data: string, sampleRate = 24000): AudioBuffer | null => {
    const ctx = getAudioContext();
    if (!ctx) return null;

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

      const audioBuffer = ctx.createBuffer(1, float32Array.length, sampleRate);
      audioBuffer.copyToChannel(float32Array, 0);
      return audioBuffer;
    } catch (e) {
      console.error('Failed to decode PCM buffer:', e);
      return null;
    }
  };

  // Pre-load all dialogue audio from pre-rendered high-fidelity audio files
  const AUDIO_VERSION = 'v3_of_course';

  useEffect(() => {
    const preloadAllTurns = async () => {
      for (let i = 0; i < scenario.dialogue.length; i++) {
        if (cachedAudioBuffersRef.current.has(i) || isFetchingAudioRef.current.has(i)) continue;
        isFetchingAudioRef.current.add(i);

        try {
          // Fetch pre-rendered high-quality WAV audio file directly from public directory with cache buster
          const res = await fetch(`/audio/turn_${i}.wav?v=${AUDIO_VERSION}`, { cache: 'no-store' });
          if (res.ok) {
            const arrayBuf = await res.arrayBuffer();
            const ctx = getAudioContext();
            if (ctx) {
              const audioBuf = await ctx.decodeAudioData(arrayBuf);
              cachedAudioBuffersRef.current.set(i, audioBuf);
            }
          }
        } catch (e) {
          console.warn(`Could not preload turn ${i} from static audio:`, e);
        } finally {
          isFetchingAudioRef.current.delete(i);
        }
      }
    };

    preloadAllTurns();
  }, [scenario.dialogue]);

  // Auto-scroll transcript container as dialogue streams
  useEffect(() => {
    dialogueEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [currentTurnIndex]);

  // Play dialogue turn starting from offset (supports accurate pause & resume)
  const speakTurn = async (turnIndex: number, onDone: () => void, startOffset = 0) => {
    const turn = scenario.dialogue[turnIndex];
    if (!turn) {
      setTimeout(onDone, 3500);
      return;
    }

    setCurrentSpeaker(turn.speaker);
    stopPcmAudio();

    // Check if high-fidelity natural audio buffer is cached
    let buffer = cachedAudioBuffersRef.current.get(turnIndex);

    if (!buffer) {
      // Fetch pre-rendered audio instantly if not yet preloaded with cache buster
      try {
        const res = await fetch(`/audio/turn_${turnIndex}.wav?v=${AUDIO_VERSION}`, { cache: 'no-store' });
        if (res.ok) {
          const arrayBuf = await res.arrayBuffer();
          const ctx = getAudioContext();
          if (ctx) {
            buffer = await ctx.decodeAudioData(arrayBuf);
            if (buffer) {
              cachedAudioBuffersRef.current.set(turnIndex, buffer);
            }
          }
        }
      } catch (err) {
        console.warn('Direct WAV audio fetch failed, falling back to TTS API:', err);
      }
    }

    if (buffer) {
      const ctx = getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          await ctx.resume().catch(() => {});
        }

        const source = ctx.createBufferSource();
        source.buffer = buffer;
        
        if (gainNodeRef.current) {
          gainNodeRef.current.gain.value = isAudioMuted ? 0 : 1;
          source.connect(gainNodeRef.current);
        } else {
          source.connect(ctx.destination);
        }

        activeTurnIndexRef.current = turnIndex;
        turnStartTimeRef.current = ctx.currentTime - startOffset;
        isTurnPlayingRef.current = true;

        source.onended = () => {
          activeSourcesRef.current = activeSourcesRef.current.filter(s => s !== source);
          isTurnPlayingRef.current = false;
          turnPauseOffsetRef.current = 0;
          onDone();
        };

        activeSourcesRef.current.push(source);
        const safeOffset = Math.max(0, Math.min(startOffset, buffer.duration - 0.05));
        source.start(0, safeOffset);
        return;
      }
    }

    // Fallback: Browser Web Speech API with tuned pitches if AudioContext is unavailable
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(turn.text);
      const isCaller = turn.speaker === 'caller';
      
      if (isCaller) {
        const voices = window.speechSynthesis.getVoices();
        const regionalVoice = voices.find(v => 
          v.lang.includes('SG') || 
          v.lang.includes('MY') || 
          v.name.toLowerCase().includes('singapore') || 
          v.name.toLowerCase().includes('malaysia')
        );
        if (regionalVoice) {
          utterance.voice = regionalVoice;
        }
      }

      utterance.pitch = isCaller ? 1.15 : 0.88;
      utterance.rate = 1.0;
      utterance.onend = () => {
        isTurnPlayingRef.current = false;
        onDone();
      };
      utterance.onerror = () => {
        isTurnPlayingRef.current = false;
        onDone();
      };
      isTurnPlayingRef.current = true;
      window.speechSynthesis.speak(utterance);
    } else {
      setTimeout(onDone, 3800);
    }
  };

  // Synchronized simulation speech controller
  useEffect(() => {
    let callTimer: NodeJS.Timeout;
    let alertTimer: NodeJS.Timeout;
    let calendarTimer: NodeJS.Timeout;
    let wordTimer: NodeJS.Timeout;

    if (isPlaying) {
      callTimer = setInterval(() => {
        setCallElapsedSeconds(prev => prev + 1);
      }, 1000);

      const activeTurn = scenario.dialogue[currentTurnIndex];
      const words = activeTurn ? activeTurn.text.split(' ') : [];
      const totalWords = words.length;

      // Approximate durations per turn: Turn 0: 7.9s, Turn 1: 9.0s, Turn 2: 5.2s, Turn 3: 5.2s
      const turnDurations = [7.9, 9.0, 5.2, 5.2];
      const durationSeconds = turnDurations[currentTurnIndex] || 6.0;
      const msPerWord = Math.max(90, (durationSeconds * 1000) / Math.max(1, totalWords));

      // Resume from saved pause offset if resuming current turn, or from 0
      const offsetToPlay = turnPauseOffsetRef.current;
      const initialWordIdx = Math.min(totalWords, Math.floor((offsetToPlay * 1000) / msPerWord));
      setVisibleWordCount(initialWordIdx);

      wordTimer = setInterval(() => {
        setVisibleWordCount(prev => {
          if (prev < totalWords) {
            return prev + 1;
          }
          return prev;
        });
      }, msPerWord);

      // Trigger the alert right after Priya says "massage" (~4.3s into turn 0)
      if (currentTurnIndex === 0) {
        const elapsedSoFar = turnPauseOffsetRef.current * 1000;
        const delayUntilMassage = Math.max(0, 4300 - elapsedSoFar);
        alertTimer = setTimeout(() => {
          setShowTherapistAlert(true);
        }, delayUntilMassage);

        // Once 3 PM. is said (~6.2s into turn 0), immediately trigger a calendar search
        const delayUntil3PM = Math.max(0, 6200 - elapsedSoFar);
        calendarTimer = setTimeout(() => {
          setCalendarSearchState('searching');
        }, delayUntil3PM);
      } else if (currentTurnIndex === 1) {
        setShowTherapistAlert(true);
        // Switch to Google Calendar icon and 'Slot available' once James finishes saying "Let me check..." (~4.2s into turn 1)
        const elapsedSoFar = turnPauseOffsetRef.current * 1000;
        const delayUntilCheckFinished = Math.max(0, 4200 - elapsedSoFar);
        if (calendarSearchState !== 'ready') {
          calendarTimer = setTimeout(() => {
            setCalendarSearchState('ready');
          }, delayUntilCheckFinished);
        }
      } else if (currentTurnIndex > 1) {
        setShowTherapistAlert(true);
        setCalendarSearchState('ready');
      }

      speakTurn(currentTurnIndex, () => {
        if (!isPlaying) return;
        setVisibleWordCount(totalWords);
        if (currentTurnIndex < scenario.dialogue.length - 1) {
          // Right after Ms. Sharma's second statement (turn 2), immediately trigger WhatsApp and Room Billing actions
          if (currentTurnIndex === 2) {
            setWhatsappActionState('sending');
            setBillingActionState('adding');
          }
          setTimeout(() => {
            setCurrentTurnIndex(prev => prev + 1);
            setVisibleWordCount(0);
          }, 500);
        } else {
          // Call finishes (end of turn 3) -> complete the WhatsApp and Billing actions
          setWhatsappActionState('sent');
          setBillingActionState('added');
          setIsPlaying(false);
          setCurrentSpeaker(null);
        }
      }, offsetToPlay);
    } else {
      stopPcmAudio();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
      setCurrentSpeaker(null);
    }

    return () => {
      clearInterval(callTimer);
      clearInterval(wordTimer);
      clearTimeout(alertTimer);
      clearTimeout(calendarTimer);
      if (calendarSpinnerTimeoutRef.current) {
        clearTimeout(calendarSpinnerTimeoutRef.current);
      }
      stopPcmAudio();
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [isPlaying, currentTurnIndex]);

  const handleStartSimulation = async () => {
    const ctx = getAudioContext();
    if (ctx && ctx.state === 'suspended') {
      await ctx.resume().catch(() => {});
    }

    if (currentTurnIndex >= scenario.dialogue.length - 1) {
      setCurrentTurnIndex(0);
      setVisibleWordCount(0);
      setCallElapsedSeconds(0);
      setActionResult(null);
      setShowTherapistAlert(false);
      setCalendarSearchState('idle');
      setWhatsappActionState('idle');
      setBillingActionState('idle');
      turnPauseOffsetRef.current = 0;
    }

    setHasCallStarted(true);
    setIsPlaying(true);
  };

  const handlePauseSimulation = () => {
    const ctx = audioContextRef.current;
    if (ctx && isTurnPlayingRef.current) {
      const elapsed = ctx.currentTime - turnStartTimeRef.current;
      turnPauseOffsetRef.current = Math.max(0, elapsed);
    }
    setIsPlaying(false);
    stopPcmAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  const handleResetSimulation = () => {
    setIsPlaying(false);
    stopPcmAudio();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (calendarSpinnerTimeoutRef.current) {
      clearTimeout(calendarSpinnerTimeoutRef.current);
    }
    setHasCallStarted(false);
    setCurrentTurnIndex(0);
    setVisibleWordCount(0);
    setCallElapsedSeconds(0);
    setActionResult(null);
    setCurrentSpeaker(null);
    setShowTherapistAlert(false);
    setCalendarSearchState('idle');
    setWhatsappActionState('idle');
    setBillingActionState('idle');
    turnPauseOffsetRef.current = 0;
    activeTurnIndexRef.current = -1;
    isTurnPlayingRef.current = false;
  };

  const handleExecuteAutonomousAction = async () => {
    setIsExecutingAction(true);
    try {
      const res = await fetch('/api/copilot/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scenarioId: scenario.id,
          callerName: scenario.callerName,
          actionType: scenario.autonomousAction.actionType,
          details: scenario.autonomousAction.details,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setActionResult(data);
      }
    } catch (err) {
      console.error('Failed to execute copilot action:', err);
    } finally {
      setIsExecutingAction(false);
    }
  };

  const activeTurn = scenario.dialogue[currentTurnIndex] || scenario.dialogue[0];
  const isCallFinished = currentTurnIndex >= scenario.dialogue.length - 1;

  const formatCallTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  };

  return (
    <div className="flex h-screen bg-white font-sans antialiased text-[#1C1C1E] overflow-hidden">
      <Sidebar />

      <main className="flex-1 flex flex-col min-w-0 overflow-hidden bg-white">

        {/* Live Call Control Banner */}
        <div className="bg-white border-b border-[#E5E5E7] px-6 py-3 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <div className="flex items-center gap-3">
              <div className="flex items-center justify-center">
                <PhoneCall className="w-6 h-6 text-gray-800" />
              </div>

              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold text-gray-900">{scenario.callerName}</span>
                  <span className="text-[10px] font-semibold px-2.5 py-0.5 rounded-full bg-[#EAB308] text-white">
                    {scenario.vipTier}
                  </span>
                </div>
                <p className="text-[11px] text-gray-500 mt-0.5">
                  Caller ID: {scenario.callerPhone}
                </p>
              </div>
            </div>

            {/* Audio Waveform Animation when Call is Active */}
          </div>

          {/* Simulation Control Buttons */}
          <div className="flex items-center gap-2">
            {!isPlaying ? (
              <button
                onClick={handleStartSimulation}
                className="flex items-center gap-2 bg-[#FF751F] hover:bg-[#E6620F] text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all cursor-pointer shadow-none border-0 active:scale-[0.98]"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                <span>{!hasCallStarted ? 'Call' : 'Play'}</span>
              </button>
            ) : (
              <button
                onClick={handlePauseSimulation}
                className="flex items-center gap-2 bg-[#FF751F] hover:bg-[#E6620F] text-white text-xs font-semibold px-4 py-2 rounded-xl transition-all cursor-pointer shadow-none border-0 active:scale-[0.98]"
              >
                <Pause className="w-3.5 h-3.5 fill-current" />
                <span>Pause</span>
              </button>
            )}

            <button
              onClick={handleToggleMute}
              className={`p-1.5 rounded-lg transition-colors cursor-pointer bg-transparent border-0 ${
                isAudioMuted
                  ? 'text-red-500 hover:text-red-600'
                  : 'text-gray-400 hover:text-gray-700'
              }`}
              title={isAudioMuted ? 'Unmute Audio' : 'Mute Voice'}
            >
              {isAudioMuted ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
            </button>

            <button
              onClick={handleResetSimulation}
              className="p-2 rounded-xl text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors cursor-pointer"
              title="Reset Call"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Master-Detail Split Workspace */}
        <div className="flex-1 flex flex-col lg:flex-row min-h-0 overflow-hidden bg-white">
          {/* LEFT: Live Audio Transcript Stream (Compact & Focused) */}
          <div className="w-full lg:w-[38%] xl:w-[36%] border-r border-[#E5E5E7] bg-white flex flex-col min-h-0 shrink-0">
            {/* Live Audio Transcript Stream (Clean Document Transcript Style) */}
            <div className="flex-1 overflow-y-auto no-scrollbar p-5 space-y-4 bg-white font-sans">
              {!hasCallStarted ? (
                <div className="w-full py-5 px-6 flex items-center justify-center text-center">
                  <p className="text-xs text-gray-400 font-normal">
                    No transcript available
                  </p>
                </div>
              ) : (
                scenario.dialogue.slice(0, currentTurnIndex + 1).map((turn, idx) => {
                  const isCaller = turn.speaker === 'caller';
                  const isCurrentlySpeaking = currentSpeaker === turn.speaker && idx === currentTurnIndex;

                  return (
                    <div
                      key={idx}
                      className="animate-in fade-in slide-in-from-bottom-1"
                    >
                      {/* Speaker Header */}
                      <div className="flex items-center justify-between gap-3 mb-1">
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-semibold text-gray-900 tracking-tight">
                            {turn.speakerName}
                          </span>
                          {isCurrentlySpeaking && (
                            <span className="inline-flex items-center gap-0.5 h-3 ml-1" title="Speaking">
                              <span className="w-[2.5px] h-2 bg-[#FF751F] rounded-full animate-pulse" style={{ animationDuration: '450ms' }} />
                              <span className="w-[2.5px] h-3.5 bg-[#FF751F] rounded-full animate-pulse" style={{ animationDuration: '650ms', animationDelay: '100ms' }} />
                              <span className="w-[2.5px] h-2 bg-[#FF751F] rounded-full animate-pulse" style={{ animationDuration: '500ms', animationDelay: '200ms' }} />
                              <span className="w-[2.5px] h-3 bg-[#FF751F] rounded-full animate-pulse" style={{ animationDuration: '700ms', animationDelay: '150ms' }} />
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Verbatim Transcribed Text streaming word-by-word */}
                      <p className="text-[13px] text-gray-700 leading-relaxed font-normal">
                        {idx < currentTurnIndex ? (
                          turn.text
                        ) : (
                          turn.text
                            .split(' ')
                            .slice(0, Math.max(0, visibleWordCount))
                            .join(' ')
                        )}
                      </p>
                    </div>
                  );
                })
              )}
              <div ref={dialogueEndRef} />
            </div>
          </div>

          {/* RIGHT: Alerts, Actions & Profile matching the design style */}
          <div className="flex-1 bg-white flex flex-col min-h-0 overflow-y-auto no-scrollbar p-6 space-y-6">
            
            {/* CARD 1: ALERTS (Permanently visible) */}
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between pb-0.5">
                <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                  <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                    Alerts
                  </h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                    {showTherapistAlert ? 1 : 0}
                  </span>
                </div>
              </div>

              {showTherapistAlert ? (
                /* Super clear solid red alert card with just the text Prefers Female Therapist - matching exact size and padding of empty state */
                <div className="w-full rounded-2xl border border-[#EF4444] bg-[#EF4444] text-white py-3.5 px-6 flex items-center justify-center text-center shadow-none transition-all duration-300 animate-in fade-in min-h-[52px]">
                  <h4 className="text-[15px] sm:text-base font-bold text-white tracking-tight leading-snug">
                    Prefers Female Therapist
                  </h4>
                </div>
              ) : (
                /* Empty state container matching Profile card border exactly */
                <div className="w-full rounded-2xl border border-gray-200/90 bg-white py-3.5 px-6 flex items-center justify-center text-center shadow-none transition-all duration-300 min-h-[52px]">
                  <p className="text-xs text-gray-400 font-normal">
                    No active alerts
                  </p>
                </div>
              )}
            </div>

            {/* CARD 2: ACTIONS (Permanently visible) */}
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between pb-0.5">
                <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                  <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                    Actions
                  </h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                    {(calendarSearchState !== 'idle' ? 1 : 0) + (whatsappActionState !== 'idle' ? 1 : 0) + (billingActionState !== 'idle' ? 1 : 0)}
                  </span>
                </div>
              </div>

              {calendarSearchState !== 'idle' || whatsappActionState !== 'idle' || billingActionState !== 'idle' ? (
                /* Actions table card matching Profile card border exactly */
                <div className="w-full rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none animate-in fade-in duration-300">
                  <div className="divide-y divide-gray-100 px-4 sm:px-6">
                    {/* Action 1: Google Calendar Slot Check */}
                    {calendarSearchState !== 'idle' && (
                      <div className="py-3.5 sm:py-4">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                          {/* Title area: Just the logo and app name */}
                          <div className="sm:col-span-4 lg:col-span-3 pr-2 flex items-center gap-2.5">
                            <img
                              src="/icons/google-calendar.png"
                              alt="Google Calendar"
                              className="w-6 h-6 object-contain shrink-0"
                            />
                            <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug">
                              Google Calendar
                            </span>
                          </div>

                          {/* Details area: Checking Calendar with spinner when searching, Slot available when ready */}
                          <div className="sm:col-span-8 lg:col-span-9 pr-2">
                            {calendarSearchState === 'searching' ? (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-[#FF751F] animate-spin shrink-0" strokeWidth={2.5} />
                                <span>Checking Calendar</span>
                              </p>
                            ) : (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-800 font-medium leading-relaxed font-sans whitespace-pre-wrap break-words animate-in fade-in duration-200 flex items-center gap-1.5">
                                <Check className="w-4 h-4 text-[#FF751F] shrink-0" strokeWidth={2.75} />
                                <span>Slot available (Senior female therapist)</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action 2: WhatsApp Confirmation */}
                    {whatsappActionState !== 'idle' && (
                      <div className="py-3.5 sm:py-4 animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                          {/* Title area: Just the logo and app name */}
                          <div className="sm:col-span-4 lg:col-span-3 pr-2 flex items-center gap-2.5">
                            <img
                              src="/icons/whatsapp.png"
                              alt="WhatsApp"
                              className="w-6 h-6 object-contain shrink-0"
                            />
                            <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug">
                              WhatsApp
                            </span>
                          </div>

                          {/* Details area: Sending confirmation with spinner when sending, Confirmation sent once call finishes */}
                          <div className="sm:col-span-8 lg:col-span-9 pr-2">
                            {whatsappActionState === 'sending' ? (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-[#FF751F] animate-spin shrink-0" strokeWidth={2.5} />
                                <span>Sending confirmation</span>
                              </p>
                            ) : (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-800 font-medium leading-relaxed font-sans whitespace-pre-wrap break-words flex items-center gap-1.5 animate-in fade-in duration-200">
                                <Check className="w-4 h-4 text-[#FF751F] shrink-0" strokeWidth={2.75} />
                                <span>Confirmation sent</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Action 3: Room Folio Billing */}
                    {billingActionState !== 'idle' && (
                      <div className="py-3.5 sm:py-4 animate-in fade-in slide-in-from-top-1 duration-300">
                        <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                          {/* Title area: Just the logo and app name */}
                          <div className="sm:col-span-4 lg:col-span-3 pr-2 flex items-center gap-2.5">
                            <Receipt className="w-6 h-6 text-gray-700 shrink-0" />
                            <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug">
                              Room Charge
                            </span>
                          </div>

                          {/* Details area: Adding to bill for checkout billing */}
                          <div className="sm:col-span-8 lg:col-span-9 pr-2">
                            {billingActionState === 'adding' ? (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words flex items-center gap-2">
                                <Loader2 className="w-4 h-4 text-[#FF751F] animate-spin shrink-0" strokeWidth={2.5} />
                                <span>Adding to bill for checkout billing</span>
                              </p>
                            ) : (
                              <p className="text-[13px] sm:text-[13.5px] text-gray-800 font-medium leading-relaxed font-sans whitespace-pre-wrap break-words flex items-center gap-1.5 animate-in fade-in duration-200">
                                <Check className="w-4 h-4 text-[#FF751F] shrink-0" strokeWidth={2.75} />
                                <span>Added to Suite 1802 bill (RM 480)</span>
                              </p>
                            )}
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              ) : (
                /* Empty state container matching Profile card border exactly */
                <div className="w-full rounded-2xl border border-gray-200/90 bg-white py-5 px-6 flex items-center justify-center text-center shadow-none transition-all duration-300">
                  <p className="text-xs text-gray-400 font-normal">
                    No pending actions
                  </p>
                </div>
              )}
            </div>

            {/* Profile Knowledge & Memory Table */}
            <div className="w-full space-y-1.5">
              <div className="flex items-center justify-between pb-0.5">
                <div className="flex items-center gap-2.5 pb-1 border-b-2 border-[#FF751F]">
                  <h3 className="text-xs sm:text-[13px] font-bold uppercase tracking-wider text-gray-900">
                    Profile
                  </h3>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[#FF751F] text-white leading-none">
                    9
                  </span>
                </div>
              </div>

              <div className="w-full rounded-2xl border border-gray-200/90 bg-white overflow-hidden shadow-none">
                <div className="divide-y divide-gray-100 px-4 sm:px-6">
                  {/* Fact 1 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Prefers Female Therapist
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Always requests a certified female therapist for massage treatments.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 2 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Severe Nut Allergy
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Allergic to peanuts, pecans, and walnuts. Keep kitchen surfaces and food completely nut-free.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 3 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Halal Meals Only
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Eats only Halal food. No alcohol or cooking wine in dishes.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 4 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Baby Cot &amp; Sterilizer
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Place a baby cot with fresh sheets and a bottle sterilizer in the room before check-in.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 5 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Away From Elevators
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Needs a quiet room far from elevators and ice machines.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 6 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Late Checkout at 2 PM
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Usually needs late checkout until 2:00 PM for afternoon flights.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 7 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Airport Pickup (KLIA T1)
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Always books the hotel Mercedes sedan for airport pickup and drop-off.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 8 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          Bill to Company Account
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Charge stay directly to her registered corporate account and email the receipt to finance.
                        </p>
                      </div>
                    </div>
                  </div>

                  {/* Fact 9 */}
                  <div className="w-full py-3.5 sm:py-4">
                    <div className="grid grid-cols-1 sm:grid-cols-12 gap-3 sm:gap-4 items-start sm:items-center">
                      <div className="sm:col-span-4 lg:col-span-3 pr-2">
                        <span className="text-[13.5px] sm:text-[14px] font-semibold text-gray-900 leading-snug break-words block">
                          No Wake-up Calls
                        </span>
                      </div>
                      <div className="sm:col-span-8 lg:col-span-9 pr-2">
                        <p className="text-[13px] sm:text-[13.5px] text-gray-600 leading-relaxed font-sans whitespace-pre-wrap break-words">
                          Do not make morning wake-up calls or promo calls to the room.
                        </p>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            </div>

          </div>
        </div>
      </main>
    </div>
  );
}
