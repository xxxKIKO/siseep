import type * as React from 'react';
import { Label } from './label';

interface FormFieldProps {
  id: string;
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactElement;
}

/** Label + control + Spanish error message, wired for screen readers. */
export function FormField({ id, label, error, hint, children }: FormFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <Label htmlFor={id}>{label}</Label>
      {children}
      {hint && !error ? <p className="text-xs text-muted-foreground">{hint}</p> : null}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}
