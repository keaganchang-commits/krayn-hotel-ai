import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Krayn AI - Autonomous Email & Document Knowledge System',
  description: 'AI learning system monitoring Gmail, PDF documents, and user instructions with interactive clarification loops.',
  icons: {
    icon: [
      { url: '/favicon.ico' },
      { url: '/logo-icon.png', type: 'image/png' },
    ],
    apple: '/apple-icon.png',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="h-full">
      <body className="h-full flex flex-col font-sans">
        {children}
      </body>
    </html>
  );
}
