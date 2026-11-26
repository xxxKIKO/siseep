import { describe, expect, it } from 'vitest';
import { defineAbilityFor, subject } from '../src/abilities';
import {
  createActivitySchema,
  createNoteSchema,
  gradeEntrySchema,
  isNoteVisibleToGuardians,
  normalizeNoteVisibility,
  saveGradesSchema,
  scoreSchema,
  shortStudentName,
} from '../src/schemas/capture';

const STUDENT = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const OTHER = 'bbbbbbbbbbbbbbbbbbbbbbbb';

describe('scoreSchema', () => {
  it.each([0, 5, 8.5, 9.9, 10])('accepts %s', (n) => {
    expect(scoreSchema.safeParse(n).success).toBe(true);
  });

  it.each([
    [14, 'La calificación va de 0 a 10'],
    [-1, 'La calificación va de 0 a 10'],
    [10.5, 'La calificación va de 0 a 10'],
    [8.55, 'Usa máximo un decimal'],
  ])('rejects %s', (n, message) => {
    const result = scoreSchema.safeParse(n);
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe(message);
  });

  it('does not trip on floating point (8.3 * 10)', () => {
    expect(scoreSchema.safeParse(8.3).success).toBe(true);
    expect(scoreSchema.safeParse(0.7).success).toBe(true);
  });
});

describe('gradeEntrySchema', () => {
  it('requires a score for SCORED', () => {
    const result = gradeEntrySchema.safeParse({ studentId: STUDENT, status: 'SCORED' });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.message).toBe('Escribe la calificación');
  });

  it('stores NOT_DELIVERED as 0 and EXCUSED as null', () => {
    expect(
      gradeEntrySchema.parse({ studentId: STUDENT, status: 'NOT_DELIVERED', score: 9 }).score,
    ).toBe(0);
    expect(
      gradeEntrySchema.parse({ studentId: STUDENT, status: 'EXCUSED', score: 9 }).score,
    ).toBeNull();
    expect(gradeEntrySchema.parse({ studentId: STUDENT, status: 'SCORED', score: 7.5 }).score).toBe(
      7.5,
    );
  });

  it('rejects a batch with the same student twice', () => {
    const result = saveGradesSchema.safeParse({
      grades: [
        { studentId: STUDENT, status: 'SCORED', score: 8 },
        { studentId: STUDENT, status: 'SCORED', score: 9 },
        { studentId: OTHER, status: 'EXCUSED' },
      ],
    });
    expect(result.success).toBe(false);
  });
});

describe('createActivitySchema', () => {
  const base = {
    groupId: STUDENT,
    periodId: OTHER,
    fieldKey: 'lenguajes',
    name: 'Dictado',
    date: '2026-12-01',
  };

  it('requires subjectKey only for COMPLEMENTARIA', () => {
    expect(createActivitySchema.safeParse({ ...base, component: 'DESEMPENO' }).success).toBe(true);
    expect(createActivitySchema.safeParse({ ...base, component: 'COMPLEMENTARIA' }).success).toBe(
      false,
    );
    expect(
      createActivitySchema.safeParse({ ...base, component: 'COMPLEMENTARIA', subjectKey: 'ingles' })
        .success,
    ).toBe(true);
    expect(
      createActivitySchema.safeParse({ ...base, component: 'EXAMEN', subjectKey: 'ingles' })
        .success,
    ).toBe(false);
  });

  it('is visible to guardians by default', () => {
    expect(createActivitySchema.parse({ ...base, component: 'PROYECTO' }).visibleToGuardians).toBe(
      true,
    );
  });
});

describe('student notes and guardians', () => {
  it('never shows SALUD notes to guardians', () => {
    expect(normalizeNoteVisibility('SALUD', true)).toBe(false);
    expect(normalizeNoteVisibility('ACADEMICO', true)).toBe(true);
    expect(isNoteVisibleToGuardians({ kind: 'SALUD', visibleToGuardians: true })).toBe(false);
    expect(isNoteVisibleToGuardians({ kind: 'CONDUCTA', visibleToGuardians: true })).toBe(true);
    expect(isNoteVisibleToGuardians({ kind: 'CONDUCTA', visibleToGuardians: false })).toBe(false);
  });

  it('notes are private by default', () => {
    expect(
      createNoteSchema.parse({ kind: 'OTRO', text: 'Hola', date: '2026-12-01' }).visibleToGuardians,
    ).toBe(false);
  });
});

// Permission tests: never delete or skip (see CLAUDE.md).
describe('notes and audit permissions', () => {
  const SCHOOL = 'cccccccccccccccccccccccc';
  const GROUP = 'dddddddddddddddddddddddd';
  const teacher = { id: '111111111111111111111111', schoolId: SCHOOL, roles: ['TEACHER'] as const };
  const homeroom = defineAbilityFor(teacher, {
    assignments: [{ groupId: GROUP, scope: 'HOMEROOM' }],
  });
  const note = (authorId: string) =>
    subject('StudentNote', { schoolId: SCHOOL, groupId: GROUP, authorId });

  it('the homeroom teacher reads all notes of the group but edits only hers', () => {
    expect(homeroom.can('read', note(OTHER))).toBe(true);
    expect(homeroom.can('create', note(teacher.id))).toBe(true);
    expect(homeroom.can('update', note(teacher.id))).toBe(true);
    expect(homeroom.can('update', note(OTHER))).toBe(false);
    expect(homeroom.can('delete', note(OTHER))).toBe(false);
  });

  it('a subject teacher has no notes but reads the audit of her subject', () => {
    const english = defineAbilityFor(teacher, {
      assignments: [{ groupId: GROUP, scope: 'SUBJECT', subjectKey: 'ingles' }],
    });
    expect(english.can('create', note(teacher.id))).toBe(false);
    expect(
      english.can(
        'read',
        subject('AuditLog', { schoolId: SCHOOL, groupId: GROUP, subjectKey: 'ingles' }),
      ),
    ).toBe(true);
    expect(english.can('read', subject('AuditLog', { schoolId: SCHOOL, groupId: GROUP }))).toBe(
      false,
    );
  });

  it('teachers read the audit log of their groups only', () => {
    expect(homeroom.can('read', subject('AuditLog', { schoolId: SCHOOL, groupId: GROUP }))).toBe(
      true,
    );
    expect(homeroom.can('read', subject('AuditLog', { schoolId: SCHOOL, groupId: OTHER }))).toBe(
      false,
    );
  });
});

describe('shortStudentName', () => {
  it('uses the first given name and the paternal surname', () => {
    expect(shortStudentName({ firstName: 'Edgar Mateo', lastName1: 'Aguilar' })).toBe(
      'Edgar Aguilar',
    );
  });
});
