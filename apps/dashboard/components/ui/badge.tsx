import * as React from 'react';
import { cn } from '@/lib/utils';

/**
 * Status badges always pair icon + label — color never carries meaning alone
 * (dataviz non-negotiable).
 */
export function Badge({
  className,
  variant = 'neutral',
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { variant?: 'neutral' | 'good' | 'critical' }) {
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium',
        variant === 'neutral' && 'border-border text-secondary-foreground',
        variant === 'good' && 'border-status-good/40 text-status-good',
        variant === 'critical' && 'border-status-critical/40 text-status-critical',
        className,
      )}
      {...props}
    />
  );
}
