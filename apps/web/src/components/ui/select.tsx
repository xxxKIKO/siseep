import type * as React from 'react';
import { cn } from '@/lib/utils';

/** Native select: on phones it opens the system picker, which is the easiest to use. */
export function Select({ className, children, ...props }: React.ComponentProps<'select'>) {
  return (
    <select
      className={cn(
        'flex h-11 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
