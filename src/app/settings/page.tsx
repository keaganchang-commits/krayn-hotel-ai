'use client';

import React, { useState, useEffect } from 'react';
import Sidebar from '@/components/Sidebar';
import {
  Power,
  Sparkles,
  ShieldCheck,
  CheckCircle2,
  Clock,
  Mail,
  Zap,
  Info,
  CalendarDays,
  FileText,
  Download,
  ExternalLink
} from 'lucide-react';

export default function SettingsPage() {
  const [autoReplyEnabled, setAutoReplyEnabled] = useState(true);
  const [enabledAt, setEnabledAt] = useState<string | null>(null);
  const [isTurboActive, setIsTurboActive] = useState(false);
  const [turboModeUntil, setTurboModeUntil] = useState<number | null>(null);
  const [turboTimeLeft, setTurboTimeLeft] = useState<string>('');
  const [isLoading, setIsLoading] = useState(true);
  const [isUpdating, setIsUpdating] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/gmail/autoreply')
      .then(res => res.json())
      .then(data => {
        if (data.success) {
          setAutoReplyEnabled(data.enabled);
          if (data.enabledAt) setEnabledAt(data.enabledAt);
          setIsTurboActive(!!data.isTurboActive);
          setTurboModeUntil(data.turboModeUntil || null);
        }
      })
      .catch(err => console.error('Failed to load auto-reply config:', err))
      .finally(() => setIsLoading(false));
  }, []);

  // Countdown timer for Turbo Mode
  useEffect(() => {
    if (!turboModeUntil) {
      setTurboTimeLeft('');
      return;
    }

    const updateCountdown = () => {
      const remainingMs = turboModeUntil - Date.now();
      if (remainingMs <= 0) {
        setIsTurboActive(false);
        setTurboModeUntil(null);
        setTurboTimeLeft('');
      } else {
        const mins = Math.floor(remainingMs / 60000);
        const secs = Math.floor((remainingMs % 60000) / 1000);
        setTurboTimeLeft(`${mins}:${secs < 10 ? '0' : ''}${secs}`);
      }
    };

    updateCountdown();
    const timer = setInterval(updateCountdown, 1000);
    return () => clearInterval(timer);
  }, [turboModeUntil]);

  const handleToggleTurbo = async () => {
    const nextTurbo = !isTurboActive;
    setIsUpdating(true);
    try {
      const res = await fetch('/api/gmail/autoreply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turbo: nextTurbo, durationMinutes: 30 }),
      });
      const data = await res.json();
      if (data.success) {
        setIsTurboActive(data.isTurboActive);
        setTurboModeUntil(data.turboModeUntil);
        setStatusMessage(data.message);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.error('Failed to toggle turbo mode:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  const handleToggle = async () => {
    const nextState = !autoReplyEnabled;
    setIsUpdating(true);
    try {
      const res = await fetch('/api/gmail/autoreply', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: nextState }),
      });
      const data = await res.json();
      if (data.success) {
        setAutoReplyEnabled(data.enabled);
        setEnabledAt(data.enabledAt || new Date().toISOString());
        setStatusMessage(data.message);
        setTimeout(() => setStatusMessage(null), 4000);
      }
    } catch (err) {
      console.error('Failed to toggle auto-reply:', err);
    } finally {
      setIsUpdating(false);
    }
  };

  return (
    <div className="flex h-screen bg-white overflow-hidden text-gray-900 font-sans">
      <Sidebar />

      <main className="flex-1 flex flex-col h-full bg-[#FBFBFD] relative overflow-hidden">
        {statusMessage && (
          <div className="p-4 bg-emerald-50 border-b border-emerald-200 text-xs font-semibold text-emerald-800">
            {statusMessage}
          </div>
        )}

        <div className="flex-1 overflow-y-auto p-6 sm:p-10">
          <div className="max-w-2xl mx-auto space-y-6">
            {/* Header info */}
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900">
                System Settings
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 mt-1">
                Manage automated AI operations, email dispatch, and response rules.
              </p>
            </div>

            {/* Apple-style Card */}
            <div className="bg-white rounded-2xl border border-[#E5E5E7] shadow-2xs divide-y divide-[#E5E5E7] overflow-hidden">
              {/* Auto-Send / Auto-Reply Toggle Row */}
              <div className="p-5 sm:p-6 flex items-start justify-between gap-4">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-orange-50 text-[#FF751F] border border-orange-200/80 flex items-center justify-center shrink-0">
                      <Zap className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      Autonomous Email Auto-Send
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        autoReplyEnabled
                          ? 'bg-emerald-50 text-emerald-700 border border-emerald-200'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {autoReplyEnabled ? 'Active' : 'Disabled'}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed pt-1">
                    When enabled, Krayn AI monitors incoming inquiries and automatically dispatches
                    verified answers directly to customer emails in real time based strictly on your
                    ground-truth knowledge.
                  </p>
                </div>

                {/* Apple-style Toggle Switch */}
                <button
                  type="button"
                  onClick={handleToggle}
                  disabled={isUpdating || isLoading}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 mt-1 ${
                    autoReplyEnabled ? 'bg-emerald-600' : 'bg-gray-200'
                  }`}
                  title={autoReplyEnabled ? 'Click to turn OFF' : 'Click to turn ON'}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      autoReplyEnabled ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Live Demo Turbo Mode (3-sec polling with 30m auto-expiry) */}
              <div className="p-5 sm:p-6 flex items-start justify-between gap-4 bg-amber-50/20">
                <div className="space-y-1.5 min-w-0">
                  <div className="flex items-center gap-2">
                    <div className="w-8 h-8 rounded-xl bg-amber-50 text-amber-600 border border-amber-200/80 flex items-center justify-center shrink-0">
                      <Sparkles className="w-4 h-4" />
                    </div>
                    <span className="text-sm font-semibold text-gray-900">
                      Demo Turbo Mode (3s Instant Replies)
                    </span>
                    <span
                      className={`text-[10px] font-bold px-2 py-0.5 rounded-full uppercase tracking-wider ${
                        isTurboActive
                          ? 'bg-amber-100 text-amber-800 border border-amber-300 animate-pulse'
                          : 'bg-gray-100 text-gray-500'
                      }`}
                    >
                      {isTurboActive ? `Active • ${turboTimeLeft || '30m'}` : 'Off (Standard 20s)'}
                    </span>
                  </div>

                  <p className="text-xs text-gray-500 leading-relaxed pt-1">
                    Accelerates email scanning from 20 seconds down to <strong className="text-gray-700">3 seconds</strong> for near-instant responses during live audience demos. Automatically expires after 30 minutes to safeguard API quotas.
                  </p>
                </div>

                {/* Turbo Toggle Switch */}
                <button
                  type="button"
                  onClick={handleToggleTurbo}
                  disabled={isUpdating || isLoading}
                  className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none disabled:opacity-40 mt-1 ${
                    isTurboActive ? 'bg-amber-500' : 'bg-gray-200'
                  }`}
                  title={isTurboActive ? 'Click to turn OFF Turbo' : 'Click to turn ON Turbo (30 mins)'}
                >
                  <span
                    className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow-sm ring-0 transition duration-200 ease-in-out ${
                      isTurboActive ? 'translate-x-5' : 'translate-x-0'
                    }`}
                  />
                </button>
              </div>

              {/* Status & Safety Rules */}
              <div className="p-5 sm:p-6 bg-[#FAFAFA] space-y-3 text-xs text-gray-600">
                <div className="flex items-center gap-2 font-medium text-gray-800">
                  <ShieldCheck className="w-4 h-4 text-emerald-600" />
                  <span>Autonomous Safety Guardrails</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 pt-1">
                  <div className="flex items-start gap-2 bg-white p-3 rounded-xl border border-black/5 shadow-2xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900">Forward-Only Protection</p>
                      <p className="text-gray-500 text-[11px] leading-normal">
                        Krayn AI will never reply to historic emails. It strictly replies only to new
                        emails received after activation.
                      </p>
                    </div>
                  </div>

                  <div className="flex items-start gap-2 bg-white p-3 rounded-xl border border-black/5 shadow-2xs">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-semibold text-gray-900">Ground-Truth Fact Enforcement</p>
                      <p className="text-gray-500 text-[11px] leading-normal">
                        If an inquiry cannot be answered with 100% confidence from verified knowledge,
                        the AI holds the response and automatically queues a question in Clarifications.
                      </p>
                    </div>
                  </div>
                </div>

                {enabledAt && (
                  <div className="pt-2 text-[11px] text-gray-400 flex items-center gap-1.5">
                    <Clock className="w-3.5 h-3.5" />
                    <span>State recorded: {new Date(enabledAt).toLocaleString()}</span>
                  </div>
                )}
              </div>
            </div>

            {/* Google Calendar & Dining Outlet Card */}
            <div className="bg-white rounded-2xl border border-black/10 overflow-hidden shadow-xs">
              <div className="p-5 sm:p-6 flex items-start justify-between gap-4 border-b border-black/5">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-orange-50 border border-orange-200/60 flex items-center justify-center shrink-0">
                    <CalendarDays className="w-5 h-5 text-orange-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                      Dining Reservations & Google Calendar
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 border border-emerald-200">
                        Live Sync
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      AI inspects Google Calendar in real time, respects your 100-guest capacity cap (2 per table), and books confirmed tables directly onto your calendar.
                    </p>
                  </div>
                </div>
              </div>

              {/* Dining Configuration Specs */}
              <div className="p-5 sm:p-6 bg-[#FAFAFA] space-y-4 text-xs">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div className="bg-white p-3.5 rounded-xl border border-black/5 shadow-2xs">
                    <p className="text-gray-400 font-medium text-[11px]">Total Capacity</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">100 Guests Total</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">50 tables (2 covers each)</p>
                  </div>
                  <div className="bg-white p-3.5 rounded-xl border border-black/5 shadow-2xs">
                    <p className="text-gray-400 font-medium text-[11px]">Operating Hours</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">All-Day Dining</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">07:00 – 23:00 (7 days a week)</p>
                  </div>
                  <div className="bg-white p-3.5 rounded-xl border border-black/5 shadow-2xs">
                    <p className="text-gray-400 font-medium text-[11px]">Google Calendar Destination</p>
                    <p className="text-sm font-semibold text-gray-900 mt-0.5">primary</p>
                    <p className="text-[10px] text-gray-500 mt-0.5">Direct Calendar Sync</p>
                  </div>
                </div>

                <div className="bg-white p-3.5 rounded-xl border border-black/5 shadow-2xs flex items-center justify-between">
                  <div>
                    <p className="font-semibold text-gray-900">Service Account Zero-Prompt Sync</p>
                    <p className="text-gray-500 text-[11px] mt-0.5">
                      Drop <code className="bg-gray-100 px-1 py-0.5 rounded text-[10px] text-gray-800">service-account.json</code> in project root to authenticate server-side with zero user prompts.
                    </p>
                  </div>
                  <span className="text-[11px] font-medium text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-lg border border-emerald-200">
                    Ready
                  </span>
                </div>
              </div>
            </div>

            {/* Park Hyatt Agreement PDF Document Preview & Download Card */}
            <div className="bg-white rounded-2xl border border-black/10 overflow-hidden shadow-xs">
              <div className="p-5 sm:p-6 flex items-start justify-between gap-4 border-b border-black/5">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-amber-50 border border-amber-200/60 flex items-center justify-center shrink-0">
                    <FileText className="w-5 h-5 text-amber-700" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                      Park Hyatt Reservation Agreement (PDF)
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">
                        Executive Standard
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Generated dynamically by Krayn AI for Step 2 meeting confirmations. Features formal Hyatt brand typography, clean particulars layout, and official dual countersignature blocks.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <a
                    href="/api/agreements/preview"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 transition-colors border border-black/5 cursor-pointer"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    <span>Open in New Tab</span>
                  </a>
                  <a
                    href="/api/agreements/preview"
                    download="Park_Hyatt_Meeting_Agreement_PKH-MTG-221026.pdf"
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold text-white bg-gray-900 hover:bg-black transition-colors shadow-2xs cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Download PDF</span>
                  </a>
                </div>
              </div>

              <div className="p-4 sm:p-5 bg-[#FAFAFA] flex items-center justify-between text-xs text-gray-500">
                <div className="flex items-center gap-3">
                  <span className="font-mono text-gray-700 text-[11px] bg-white px-2.5 py-1 rounded-lg border border-black/5 font-semibold">
                    Park_Hyatt_Meeting_Agreement_PKH-MTG-221026.pdf
                  </span>
                  <span className="text-[11px] text-gray-400">• Sky Rooms (Level 114) • 22 Delegates • 22 Oct 2026</span>
                </div>
                <span className="text-[11px] text-emerald-600 font-medium flex items-center gap-1">
                  <CheckCircle2 className="w-3.5 h-3.5" /> Ready for Live Dispatch
                </span>
              </div>
            </div>

            {/* Interactive Demo Scenarios & One-Click Copy */}
            <div className="bg-white rounded-2xl border border-black/10 overflow-hidden shadow-xs">
              <div className="p-5 sm:p-6 flex items-start justify-between gap-4 border-b border-black/5">
                <div className="flex items-start gap-3.5">
                  <div className="w-10 h-10 rounded-xl bg-blue-50 border border-blue-200/60 flex items-center justify-center shrink-0">
                    <Sparkles className="w-5 h-5 text-blue-600" />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-900 tracking-tight flex items-center gap-2">
                      Executive Demo Trigger Scenarios
                      <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-700 border border-blue-200">
                        1-Click Copy
                      </span>
                    </h2>
                    <p className="text-xs text-gray-500 mt-1 leading-relaxed">
                      Copy these exact test emails to trigger the multi-turn Park Hyatt Meeting Room reservation flow with instant automated reply, calendar reservation, and PDF agreement dispatch.
                    </p>
                  </div>
                </div>
              </div>

              <div className="p-5 sm:p-6 bg-[#FAFAFA] space-y-5 text-xs">
                {/* Step 1 Email Block */}
                <div className="bg-white rounded-xl border border-black/5 p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold">1</span>
                      <span className="font-semibold text-gray-900 text-xs">Step 1: Initial Inquiry Email</span>
                    </div>
                    <span className="text-[10px] text-gray-400 font-medium">Triggers Executive Venue Options</span>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>Subject Line</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText('Meeting Room Booking - Park Hyatt KL');
                          setStatusMessage('Copied Subject Line to clipboard');
                          setTimeout(() => setStatusMessage(null), 2500);
                        }}
                        className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer text-[10px] uppercase tracking-wide"
                      >
                        Copy Subject
                      </button>
                    </div>
                    <div className="bg-[#F6F6F8] px-3 py-2 rounded-lg font-mono text-gray-800 text-[11px] select-all border border-black/5">
                      Meeting Room Booking - Park Hyatt KL
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>Email Body</span>
                      <button
                        onClick={() => {
                          const bodyText = `Dear Sir/Madam,\n\nI would like to enquire about the meeting rooms at your hotel. Could I please have more details?\n\nThank you,\n\nBest Regards,\nKeagan Chang`;
                          navigator.clipboard.writeText(bodyText);
                          setStatusMessage('Copied Email 1 Body to clipboard');
                          setTimeout(() => setStatusMessage(null), 2500);
                        }}
                        className="text-blue-600 hover:text-blue-700 font-semibold cursor-pointer text-[10px] uppercase tracking-wide"
                      >
                        Copy Body
                      </button>
                    </div>
                    <pre className="bg-[#F6F6F8] p-3 rounded-lg font-sans text-gray-800 text-[11px] leading-relaxed whitespace-pre-wrap select-all border border-black/5">
{`Dear Sir/Madam, 

I would like to enquire about the meeting rooms at your hotel. Could I please have more details?

Thank you, 

Best Regards, 
Keagan Chang`}
                    </pre>
                  </div>
                </div>

                {/* Step 2 Email Block */}
                <div className="bg-white rounded-xl border border-black/5 p-4 shadow-2xs space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] font-bold">2</span>
                      <span className="font-semibold text-gray-900 text-xs">Step 2: Confirmation Reply Email</span>
                    </div>
                    <span className="text-[10px] text-emerald-700 font-medium bg-emerald-50 px-2 py-0.5 rounded border border-emerald-200">
                      Flexible Reply • Auto-Schedules & Sends PDF
                    </span>
                  </div>

                  <p className="text-[11px] text-gray-500 leading-normal">
                    You can send any text in your reply (or use the sample below). The AI will immediately deliver the official confirmation with the PDF agreement and Google Calendar booking.
                  </p>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>Reply Subject</span>
                      <span className="text-[10px] text-gray-400">Reply directly to Step 1 thread</span>
                    </div>
                    <div className="bg-[#F6F6F8] px-3 py-2 rounded-lg font-mono text-gray-800 text-[11px] select-all border border-black/5">
                      Re: Meeting Room Booking - Park Hyatt KL
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between text-[11px] text-gray-500 font-medium">
                      <span>Email Body</span>
                      <button
                        onClick={() => {
                          const bodyText = `Dear Sir/Madam,\n\n22 October 2026, 10am-12pm, 22 people, U-Shape arrangement.\n\nThank you.\n\nBest Regards,\nKeagan Chang`;
                          navigator.clipboard.writeText(bodyText);
                          setStatusMessage('Copied Email 2 Body to clipboard');
                          setTimeout(() => setStatusMessage(null), 2500);
                        }}
                        className="text-emerald-700 hover:text-emerald-800 font-semibold cursor-pointer text-[10px] uppercase tracking-wide"
                      >
                        Copy Body
                      </button>
                    </div>
                    <pre className="bg-[#F6F6F8] p-3 rounded-lg font-sans text-gray-800 text-[11px] leading-relaxed whitespace-pre-wrap select-all border border-black/5">
{`Dear Sir/Madam, 

22 October 2026, 10am-12pm, 22 people, U-Shape arrangement.

Thank you.

Best Regards, 
Keagan Chang`}
                    </pre>
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
