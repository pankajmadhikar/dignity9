import type { ReactNode } from 'react';

export function Banner({ tone = 'error', children }: { tone?: 'error' | 'info'; children: ReactNode }) {
  const styles = tone === 'error' ? 'border-rose-200 bg-rose-50 text-rose-900' : 'border-teal/20 bg-teal-soft text-teal-dark';
  return <div className={`rounded-xl border px-3 py-2 text-sm ${styles}`}>{children}</div>;
}
