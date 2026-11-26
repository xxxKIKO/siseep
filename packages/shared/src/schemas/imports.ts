import { z } from 'zod';
import type { Component, FieldKey, SubjectKey } from '../enums';
import { objectIdSchema } from './common';

export const IMPORT_MAX_BYTES = 15 * 1024 * 1024;

export const importPreviewRequestSchema = z.object({
  groupId: objectIdSchema,
  periodId: objectIdSchema,
});
export type ImportPreviewRequest = z.infer<typeof importPreviewRequestSchema>;

export const importCommitRequestSchema = z.object({ previewId: objectIdSchema });
export type ImportCommitRequest = z.infer<typeof importCommitRequestSchema>;

/**
 * `error` (red): the cell or row is NOT imported. `warning` (yellow): imported, but review it.
 * `info`: nothing to fix. `blocking` errors prevent the commit until the Excel is fixed.
 */
export type ImportIssueSeverity = 'error' | 'warning' | 'info';

export interface ImportIssue {
  severity: ImportIssueSeverity;
  code: string;
  message: string;
  sheet?: string;
  cell?: string;
  listNumber?: number;
  blocking?: boolean;
}

export interface ImportPreviewStudent {
  listNumber: number;
  fullName: string;
  lastName1: string;
  lastName2: string;
  firstName: string;
  status: 'new' | 'existing' | 'enrolled';
}

export interface ImportPreviewActivity {
  fieldKey: FieldKey;
  component: Component;
  subjectKey?: SubjectKey;
  name: string;
  date: string;
  dateText?: string;
  sheet: string;
  column: string;
  gradeCount: number;
  notDeliveredCount: number;
  pendingCount: number;
}

export interface ImportPreview {
  previewId: string;
  expiresAt: string;
  fileName: string;
  group: { id: string; name: string };
  period: { id: string; name: string };
  summary: {
    students: { total: number; new: number; existing: number; enrolled: number };
    activitiesByField: Record<FieldKey, Record<Component, number>>;
    activities: number;
    grades: number;
    adjustments: number;
    observations: number;
    errors: number;
    warnings: number;
  };
  canCommit: boolean;
  students: ImportPreviewStudent[];
  activities: ImportPreviewActivity[];
  issues: ImportIssue[];
}

export interface ImportCommitResult {
  studentsCreated: number;
  studentsReused: number;
  enrollmentsCreated: number;
  activitiesCreated: number;
  activitiesUpdated: number;
  gradesUpserted: number;
  periodResultsUpserted: number;
}
