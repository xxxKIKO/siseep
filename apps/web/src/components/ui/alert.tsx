import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Alert({
  className,
  variant = 'error',
  ...props
}: React.ComponentProps<'div'> & { variant?: 'error' | 'info' }) {
  return (
    <div
      role={variant === 'error' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border px-3 py-2.5 text-sm',
        variant === 'error'
          ? 'border-destructive/30 bg-destructive/5 text-destructive'
          : 'border-primary/20 bg-primary-soft text-primary',
        className,
      )}
      {...props}
    />
  );
}
