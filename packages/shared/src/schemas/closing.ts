import { z } from 'zod';
import type { Component, FieldKey, PeriodStatus } from '../enums';
import { FIELD_KEYS } from '../enums';
import type { ComponentAverage, MainComponent } from '../grading/engine';
import type { NoteView } from './capture';

// ---------------------------------------------------------------------------
// Period status per group: OPEN → IN_REVIEW → CLOSED → PUBLISHED (reopen: admin only)
// ---------------------------------------------------------------------------
export const PERIOD_TRANSITIONS = ['review', 'close', 'publish', 'reopen'] as const;
export type PeriodTransition = (typeof PERIOD_TRANSITIONS)[number];

export const PERIOD_GROUP_STATUS_LABELS: Record<PeriodStatus, string> = {
  OPEN: 'Abierto',
  IN_REVIEW: 'En revisión',
  CLOSED: 'Cerrado',
  PUBLISHED: 'Publicado',
};

export const reopenPeriodSchema = z.object({
  reason: z
    .string({ message: 'Escribe el motivo' })
    .trim()
    .min(5, { message: 'Explica el motivo (mínimo 5 caracteres)' })
    .max(500),
});
export type ReopenPeriodInput = z.infer<typeof reopenPeriodSchema>;

/** Status of one group in one period. */
export interface PeriodGroupStatusView {
  periodId: string;
  groupId: string;
  groupName: string;
  homeroomTeacher?: string;
  studentCount: number;
  status: PeriodStatus;
  reviewRequestedAt?: string;
  closedAt?: string;
  closedBy?: string;
  publishedAt?: string;
  reopenedAt?: string;
  reopenReason?: string;
}

/** One field of a student that blocks the closing (section 5: no pending, no partial). */
export interface ClosingIssue {
  studentId: string;
  studentName: string;
  listNumber: number;
  fieldKey: FieldKey;
  /** Activities of the field without a grade for this student. */
  activityIds: string[];
  /** Components with no activities at all for the field. */
  missingComponents: Component[];
}

// ---------------------------------------------------------------------------
// Period results (adjustments, observations, legend) and the closing screen
// ---------------------------------------------------------------------------
const observationText = z.string().trim().max(1500, { message: 'Máximo 1500 caracteres' });

export const updatePeriodResultSchema = z.object({
  fields: z
    .array(
      z.object({
        fieldKey: z.enum(FIELD_KEYS),
        /** Integer 5-10, or null to remove the adjustment. */
        override: z
          .number({ message: 'Escribe un número' })
          .int({ message: 'El ajuste es un número entero' })
          .min(5, { message: 'El ajuste va de 5 a 10' })
          .max(10, { message: 'El ajuste va de 5 a 10' })
          .nullable()
          .optional(),
        overrideReason: z.string().trim().max(300).nullable().optional(),
      }),
    )
    .optional(),
  observations: z
    .object({
      general: observationText.nullable().optional(),
      byField: z.partialRecord(z.enum(FIELD_KEYS), observationText.nullable()).optional(),
    })
    .optional(),
  /** Replaces the suggested "Ojo en" legend; null goes back to the suggestion. */
  legendOverride: z.string().trim().max(200).nullable().optional(),
});
export type UpdatePeriodResultInput = z.infer<typeof updatePeriodResultSchema>;

export interface PeriodResultField {
  fieldKey: FieldKey;
  components: Record<MainComponent, ComponentAverage | { value: number | null }>;
  complementary: { value: number | null } | null;
  /** 0.5·D + 0.2·P + 0.3·E ("Promedio del campo" on the report card). */
  base: number | null;
  calculated: number | null;
  rounded: number | null;
  override: number | null;
  overrideReason: string | null;
  final: number | null;
  adjusted: boolean;
  partial: boolean;
  pending: number;
}

export interface PeriodResultRow {
  /** periodResults document id (PATCH /period-results/:id). */
  id: string;
  student: { id: string; listNumber: number; fullName: string; shortName: string };
  fields: PeriodResultField[];
  generalAverage: number | null;
  legendSuggested: string | null;
  legendOverride: string | null;
  observations: { general: string | null; byField: Partial<Record<FieldKey, string>> };
  /** Live calculation (OPEN/IN_REVIEW) or the snapshot taken when closing. */
  source: 'live' | 'snapshot';
  snapshotAt: string | null;
}

export interface PeriodResultsView {
  group: { id: string; name: string };
  period: { id: string; name: string; number: number };
  status: PeriodStatus;
  /** What the current user may do (buttons in the UI; the API checks again). */
  can: { edit: boolean; review: boolean; close: boolean; publish: boolean; reopen: boolean };
  rows: PeriodResultRow[];
  progress: { total: number; withObservations: number };
  /** Fields that would block the closing right now. */
  issues: ClosingIssue[];
  notes: Record<string, NoteView[]>;
}
