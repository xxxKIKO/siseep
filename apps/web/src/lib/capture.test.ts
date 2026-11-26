import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import {
  backoffDelay,
  formatGrade,
  loadPending,
  parseScoreInput,
  savePending,
  settlePending,
} from './capture';

describe('parseScoreInput', () => {
  it.each([
    ['9', { kind: 'grade', status: 'SCORED', score: 9 }],
    ['8.5', { kind: 'grade', status: 'SCORED', score: 8.5 }],
    ['8,5', { kind: 'grade', status: 'SCORED', score: 8.5 }],
    ['10', { kind: 'grade', status: 'SCORED', score: 10 }],
    ['0', { kind: 'grade', status: 'NOT_DELIVERED', score: 0 }],
    ['ne', { kind: 'grade', status: 'NOT_DELIVERED', score: 0 }],
    ['NA', { kind: 'grade', status: 'EXCUSED', score: null }],
    ['', { kind: 'empty' }],
  ])('reads %j', (input, expected) => {
    expect(parseScoreInput(input)).toEqual(expected);
  });

  it.each(['14', '10.5', '8.55', '-1', 'abc', '1.2.3'])('rejects %j', (input) => {
    expect(parseScoreInput(input).kind).toBe('invalid');
  });

  it('allows "8." while typing the decimal', () => {
    expect(parseScoreInput('8.')).toEqual({ kind: 'grade', status: 'SCORED', score: 8 });
  });
});

describe('formatGrade', () => {
  it('shows NE / NA / the number', () => {
    expect(formatGrade({ status: 'NOT_DELIVERED', score: 0 })).toBe('NE');
    expect(formatGrade({ status: 'EXCUSED', score: null })).toBe('NA');
    expect(formatGrade({ status: 'SCORED', score: 9.5 })).toBe('9.5');
    expect(formatGrade(null)).toBe('');
  });
});

describe('offline queue', () => {
  const change = (studentId: string, version: number) => ({
    studentId,
    status: 'SCORED' as const,
    score: 9,
    expectedUpdatedAt: null,
    version,
  });

  it('persists pending changes in IndexedDB', async () => {
    await savePending('act1', { s1: change('s1', 1) });
    expect(await loadPending('act1')).toEqual({ s1: change('s1', 1) });
    await savePending('act1', {});
    expect(await loadPending('act1')).toEqual({});
  });

  it('keeps edits made while saving, with the new expected version', () => {
    const sent = { s1: change('s1', 1), s2: change('s2', 1) };
    const pending = { s1: change('s1', 1), s2: change('s2', 2) };
    const next = settlePending(pending, sent, [
      { studentId: 's1', updatedAt: 'v1' },
      { studentId: 's2', updatedAt: 'v2' },
    ]);
    expect(next).toEqual({ s2: { ...change('s2', 2), expectedUpdatedAt: 'v2' } });
  });

  it('backs off up to one minute', () => {
    expect([0, 1, 2, 10].map(backoffDelay)).toEqual([2000, 4000, 8000, 60000]);
  });
});
