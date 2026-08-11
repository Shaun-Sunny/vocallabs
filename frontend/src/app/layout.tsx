import '@/styles/globals.css';
import type { Metadata } from 'next';
import { NhostProvider } from '@/components/NhostProvider';

export const metadata: Metadata = {
  title: 'AI Workflow Builder',
  description: 'Chain AI agent steps into powerful workflows',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <NhostProvider>{children}</NhostProvider>
      </body>
    </html>
  );
}
