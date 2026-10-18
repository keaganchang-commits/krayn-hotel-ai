'use client';

import React from 'react';
import { ExternalLink } from 'lucide-react';

interface EmailBodyRendererProps {
  content: string;
  html?: string;
  className?: string;
}

/**
 * Normalizes email text line breaks:
 * Email transfer protocols wrap lines aggressively at ~70-78 chars.
 * This unwraps single newline wraps within paragraphs into full-width flowing sentences,
 * while preserving actual intentional paragraph breaks (double newlines).
 */
function unwrapEmailText(raw: string): string {
  if (!raw) return '';

  const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const paragraphs = normalized.split(/\n{2,}/);

  const unwrappedParagraphs = paragraphs.map(p => {
    const lines = p.split('\n');
    let merged = '';

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      if (!merged) {
        merged = line;
      } else {
        merged += ' ' + line;
      }
    }
    return merged;
  });

  return unwrappedParagraphs.filter(Boolean).join('\n\n');
}

/**
 * Clean Apple-styled email body renderer:
 * If original HTML email structure is available, it renders the exact original design
 * in a seamless, secure, auto-resizing sandboxed frame so layout, font hierarchy,
 * buttons, and footer links match the authentic email 100%.
 * If plain text only, it gracefully renders unwrapped paragraphs with clean Apple link pills.
 */
export default function EmailBodyRenderer({ content, html, className = '' }: EmailBodyRendererProps) {
  const iframeRef = React.useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = React.useState<number>(450);

  // If HTML is present, inject base target="_blank" and enforce clean light mode
  // Many emails include '@media (prefers-color-scheme: dark)' with hardcoded black backgrounds (#000).
  // In our white interface, emails should render in their standard clean light mode!
  const processedHtml = React.useMemo(() => {
    if (!html) return '';
    let cleaned = html;

    // Neutralize prefers-color-scheme: dark so emails don't turn pitch black
    cleaned = cleaned.replace(/@media\s*\(\s*prefers-color-scheme\s*:\s*dark\s*\)/gi, '@media (prefers-color-scheme: unsupported-dark)');
    
    // Inject light mode meta and base target
    const lightModeStyles = `
      <base target="_blank">
      <meta name="color-scheme" content="light only">
      <meta name="supported-color-schemes" content="light">
      <style>
        :root { color-scheme: light !important; supported-color-schemes: light !important; }
        body { background-color: #ffffff !important; color: #1f1f1f; }
      </style>
    `;

    if (cleaned.includes('<head')) {
      cleaned = cleaned.replace(/<head[^>]*>/i, `$&${lightModeStyles}`);
    } else {
      cleaned = `${lightModeStyles}${cleaned}`;
    }

    return cleaned;
  }, [html]);

  const handleIframeLoad = () => {
    try {
      if (iframeRef.current && iframeRef.current.contentWindow) {
        const doc = iframeRef.current.contentWindow.document;
        const scrollHeight = Math.max(doc.documentElement.scrollHeight, doc.body.scrollHeight);
        if (scrollHeight && scrollHeight > 100) {
          setIframeHeight(scrollHeight + 30);
        }
      }
    } catch (e) {}
  };

  if (html) {
    return (
      <div className={`w-full overflow-hidden ${className}`}>
        <iframe
          ref={iframeRef}
          srcDoc={processedHtml}
          onLoad={handleIframeLoad}
          title="Email Content"
          sandbox="allow-popups allow-popups-to-escape-sandbox allow-same-origin"
          className="w-full border-none transition-all duration-200"
          style={{ height: `${iframeHeight}px`, minHeight: '350px' }}
        />
      </div>
    );
  }

  if (!content) return null;

  const flowingContent = unwrapEmailText(content);

  // Match ONLY the URL itself (in angle brackets or standalone).
  const urlOnlyRegex = /<(https?:\/\/[^>]+)>|(https?:\/\/[^\s<>"'{}|\\^`]+)/g;

  const elements: React.ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = urlOnlyRegex.exec(flowingContent)) !== null) {
    const matchStart = match.index;
    const matchEnd = urlOnlyRegex.lastIndex;

    const url = match[1] || match[2] || '';

    // Text between the previous match and this URL
    const rawPrecedingText = flowingContent.slice(lastIndex, matchStart);

    // Check if the end of rawPrecedingText has a natural anchor action phrase
    // e.g., "Get started", "unsubscribe", "Learn more", "Click here"
    const actionPattern = /\b(get started|unsubscribe|learn more|view details|click here|read more|sign in|download|confirm|verify|register|shop now|view in browser|opt out)\s*$/i;
    const actionMatch = rawPrecedingText.match(actionPattern);

    let textToRender = rawPrecedingText;
    let buttonLabel = '';

    if (actionMatch && actionMatch.index !== undefined) {
      // Keep everything before the action word as sentence text
      textToRender = rawPrecedingText.slice(0, actionMatch.index);
      const rawAction = actionMatch[1].trim();
      buttonLabel = rawAction.charAt(0).toUpperCase() + rawAction.slice(1);
    }

    // Clean up trailing whitespace/newlines so text and button remain tightly attached inline
    textToRender = textToRender.replace(/[\r\n\t ]+$/, '');

    if (textToRender) {
      elements.push(
        <span key={`text_${lastIndex}`} className="whitespace-pre-wrap break-words">
          {textToRender}
        </span>
      );
    }

    // Fallback button label if no action word preceded it
    if (!buttonLabel) {
      try {
        const u = new URL(url);
        const host = u.hostname.replace(/^www\./, '').replace(/^(notifications|mail|accounts|support|m|app)\./, '');
        const parts = host.split('.');
        const domainName = parts[0] || 'Link';
        buttonLabel = domainName.charAt(0).toUpperCase() + domainName.slice(1);
      } catch {
        buttonLabel = 'Link';
      }
    }

    // Render button inline immediately adjacent to sentence text
    elements.push(
      <a
        key={`link_${matchStart}`}
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 px-3 py-1 my-0.5 ml-2 mr-1 rounded-lg bg-[#E5E5EA] hover:bg-[#D1D1D6] text-black text-xs font-semibold max-w-full truncate transition-all shadow-2xs group align-baseline cursor-pointer border-none"
        title={url}
      >
        <span className="truncate">{buttonLabel}</span>
        <ExternalLink className="w-3 h-3 shrink-0 text-black/70 group-hover:text-black transition-colors" />
      </a>
    );

    lastIndex = matchEnd;
  }

  // Trailing text
  if (lastIndex < flowingContent.length) {
    elements.push(
      <span key={`text_end_${lastIndex}`} className="whitespace-pre-wrap break-words">
        {flowingContent.slice(lastIndex)}
      </span>
    );
  }

  return (
    <div className={`w-full overflow-x-hidden break-words leading-relaxed text-[#1D1D1F] ${className}`}>
      {elements}
    </div>
  );
}
