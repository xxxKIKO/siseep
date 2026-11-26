import type * as React from 'react';
import { cn } from '@/lib/utils';

export function Input({ className, type = 'text', ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      type={type}
      className={cn(
        // 16px text avoids the iOS zoom on focus.
        'flex h-11 w-full rounded-md border border-input bg-card px-3 text-base shadow-xs transition-colors placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-destructive',
        className,
      )}
      {...props}
    />
  );
}
