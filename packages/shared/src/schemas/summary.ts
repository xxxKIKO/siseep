import { z } from 'zod';
import type { Component, FieldKey, SubjectKey } from '../enums';
import type { StudentPeriodResult } from '../grading/engine';
import type { GradeValue } from './capture';
import { objectIdSchema } from './common';

export const summaryQuerySchema = z.object({ periodId: objectIdSchema });
export type SummaryQuery = z.infer<typeof summaryQuerySchema>;

/** LOW_6: calculated < 6 (red) · LOW_7: below lowThreshold (amber) · PENDING · PARTIAL. */
export type SummaryAlertType = 'LOW_6' | 'LOW_7' | 'PENDING' | 'PARTIAL';

export interface SummaryAlert {
  studentId: string;
  fieldKey: FieldKey;
  type: SummaryAlertType;
  /** Calculated grade (LOW_*) or number of pending activities (PENDING). */
  value: number | null;
}

export interface SummaryField {
  key: FieldKey;
  name: string;
  shortName: string;
  color: string;
  complementaryName?: string;
}

export interface SummaryStudent {
  student: { id: string; listNumber: number; fullName: string; shortName: string };
  result: StudentPeriodResult;
}

export type GradeBucket = 'lt6' | '6' | '7' | '8' | '9' | '10';

export interface FieldStats {
  fieldKey: FieldKey;
  /** Average of the calculated grades (students with data). */
  average: number | null;
  /** Average of the final grades (what would go on the report card). */
  finalAverage: number | null;
  /** How many students per final grade. */
  distribution: Record<GradeBucket, number>;
  /** Students below the "Ojo en" threshold. */
  lowCount: number;
}

export interface CaptureProgress {
  activities: number;
  /** activities × active students */
  expected: number;
  captured: number;
  /** 0-100, one decimal. */
  percent: number;
}

export interface PendingActivity {
  activityId: string;
  name: string;
  fieldKey: FieldKey;
  component: Component;
  subjectKey?: SubjectKey;
  date: string;
  /** Active students without a grade. */
  pending: number;
}

export interface GroupSummary {
  group: { id: string; name: string };
  period: { id: string; name: string; status: string };
  /** When it was calculated (results are cached up to 30 s). */
  generatedAt: string;
  fields: SummaryField[];
  students: SummaryStudent[];
  stats: {
    byField: FieldStats[];
    generalAverage: number | null;
    studentsWithAlerts: number;
  };
  alerts: SummaryAlert[];
  pendingActivities: PendingActivity[];
  capture: CaptureProgress;
}

export interface StudentSummaryActivity {
  id: string;
  name: string;
  component: Component;
  subjectKey?: SubjectKey;
  date: string;
  grade: GradeValue | null;
}

export interface StudentSummaryView extends SummaryStudent {
  group: { id: string; name: string };
  period: { id: string; name: string; status: string };
  generatedAt: string;
  fields: SummaryField[];
  alerts: SummaryAlert[];
  activities: { fieldKey: FieldKey; items: StudentSummaryActivity[] }[];
}

/** One row of the director's dashboard. */
export interface GroupOverview {
  group: {
    id: string;
    name: string;
    grade: number;
    schoolYearName: string;
    homeroomTeacher?: string;
  };
  period: { id: string; name: string; status: string } | null;
  studentCount: number;
  capture: CaptureProgress | null;
  byField: { fieldKey: FieldKey; average: number | null }[];
  generalAverage: number | null;
  studentsWithAlerts: number;
  alertCounts: Record<SummaryAlertType, number>;
}
