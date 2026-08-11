'use client';

import { NhostNextProvider } from '@nhost/nextjs';
import { nhost } from '@/lib/nhost';

export function NhostProvider({ children }: { children: React.ReactNode }) {
  return <NhostNextProvider nhost={nhost}>{children}</NhostNextProvider>;
}

export { nhost };
