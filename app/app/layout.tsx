import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'EFK Audits RAG',
  description: 'Semantic search & chat over Swiss EFK audit reports (FR/DE/EN/IT).',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="fr">
      <body>{children}</body>
    </html>
  );
}
