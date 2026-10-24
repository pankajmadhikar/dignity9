import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

const badgeStyles: Record<string, string> = {
  WAITING: 'bg-amber-100 text-amber-950',
  REGISTERED: 'bg-stone-200 text-stone-800',
  CALLED: 'bg-sky-100 text-sky-950',
  IN_CONSULTATION: 'bg-teal-soft text-teal-dark',
  COMPLETED: 'bg-stone-100 text-stone-600',
  CANCELLED: 'bg-stone-100 text-stone-500',
  NO_SHOW: 'bg-rose-100 text-rose-900',
  EMERGENCY: 'bg-rose-700 text-white',
  HIGH: 'bg-rose-100 text-rose-900',
  MEDIUM: 'bg-amber-100 text-amber-950',
  APPROVED: 'bg-teal-soft text-teal-dark',
  DRAFT: 'bg-stone-200 text-stone-700',
  REPORT_AVAILABLE: 'bg-sky-100 text-sky-950',
  REVIEWED: 'bg-teal-soft text-teal-dark',
  ORDERED: 'bg-stone-200 text-stone-700',
  SENT: 'bg-teal-soft text-teal-dark',
  FAILED: 'bg-rose-100 text-rose-900',
  SKIPPED: 'bg-stone-200 text-stone-700',
  QUEUED: 'bg-amber-100 text-amber-950',
};

export function Badge({ value, children, className }: { value: string; children?: ReactNode; className?: string }) {
  return (
    <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold uppercase tracking-wide', badgeStyles[value] ?? 'bg-stone-200 text-stone-700', className)}>
      {children ?? value.replaceAll('_', ' ')}
    </span>
  );
}
