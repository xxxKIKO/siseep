import ExcelJS from 'exceljs';
import { editedFixture, fixtureBuffer } from '../../test/fixture';
import {
  parseLooseDate,
  parseWorkbook,
  resolveLooseDate,
  splitObservations,
  splitStudentName,
  WorkbookReadError,
} from './excel-parser';

describe('splitStudentName', () => {
  it('takes the first two words as surnames', () => {
    expect(splitStudentName('Aguilar Cárdenas Edgar Mateo')).toEqual({
      lastName1: 'Aguilar',
      lastName2: 'Cárdenas',
      firstName: 'Edgar Mateo',
      doubtful: false,
    });
    expect(splitStudentName('  López   Ruiz  Ana ')).toMatchObject({
      firstName: 'Ana',
      doubtful: false,
    });
  });

  it('flags names it cannot split with confidence', () => {
    expect(splitStudentName('De la Cruz Ana').doubtful).toBe(true);
    expect(splitStudentName('López Ana').doubtful).toBe(true);
    expect(splitStudentName('Uno Dos Tres Cuatro Cinco').doubtful).toBe(true);
  });
});

describe('dates', () => {
  it('reads the free-text dates of the Excel', () => {
    expect(parseLooseDate('26/oct')).toEqual({ kind: 'dayMonth', day: 26, month: 10 });
    expect(parseLooseDate('4/nov')).toEqual({ kind: 'dayMonth', day: 4, month: 11 });
    expect(parseLooseDate('15-sep')).toEqual({ kind: 'dayMonth', day: 15, month: 9 });
    expect(parseLooseDate('3 de Dic.')).toEqual({ kind: 'dayMonth', day: 3, month: 12 });
    expect(parseLooseDate('26/10')).toEqual({ kind: 'dayMonth', day: 26, month: 10 });
    expect(parseLooseDate('26/10/2026')).toEqual({ kind: 'exact', iso: '2026-10-26' });
    expect(parseLooseDate('oct')).toEqual({ kind: 'month', month: 10 });
    expect(parseLooseDate(null)).toEqual({ kind: 'none' });
    expect(parseLooseDate('pendiente')).toEqual({ kind: 'none' });
  });

  it('places dates inside the school year', () => {
    expect(resolveLooseDate({ kind: 'dayMonth', day: 26, month: 10 }, 2026, '2026-08-31')).toEqual({
      date: '2026-10-26',
      quality: 'exact',
    });
    expect(resolveLooseDate({ kind: 'dayMonth', day: 15, month: 2 }, 2026, '2026-08-31').date).toBe(
      '2027-02-15',
    );
    expect(resolveLooseDate({ kind: 'month', month: 10 }, 2026, 'x')).toEqual({
      date: '2026-10-01',
      quality: 'completed',
    });
    expect(resolveLooseDate({ kind: 'none' }, 2026, '2026-08-31')).toEqual({
      date: '2026-08-31',
      quality: 'missing',
    });
  });
});

describe('splitObservations', () => {
  it('splits the paragraphs by formative field label', () => {
    const result = splitObservations(
      'Lenguajes: Lee con fluidez.\nSaberes y pensamiento científico: Repasar fracciones.\nSigue así.',
    );
    expect(result).toEqual({
      byField: { lenguajes: 'Lee con fluidez.', saberes: 'Repasar fracciones.\nSigue así.' },
    });
  });

  it('keeps text without a label as the general observation', () => {
    expect(splitObservations('Muy participativo.\nÉtica: Respetuoso.')).toEqual({
      general: 'Muy participativo.',
      byField: { etica: 'Respetuoso.' },
    });
  });
});

describe('parseWorkbook (anonymized 5°B fixture)', () => {
  it('reads students, activities, grades, adjustments and observations', async () => {
    const parsed = await parseWorkbook(fixtureBuffer());
    expect(parsed.students).toHaveLength(20);
    expect(parsed.students.map((s) => s.listNumber)).toEqual(
      Array.from({ length: 20 }, (_, i) => i + 1),
    );

    const count = (field: string, component?: string) =>
      parsed.activities.filter(
        (a) => a.fieldKey === field && (!component || a.component === component),
      ).length;
    expect(count('lenguajes')).toBe(7);
    expect(count('saberes')).toBe(10);
    expect(count('saberes', 'EXAMEN')).toBe(2); // Matemáticas y Ciencias
    expect(count('etica')).toBe(6);
    expect(count('humano')).toBe(7);
    expect(
      parsed.activities.find((a) => a.component === 'COMPLEMENTARIA' && a.fieldKey === 'lenguajes'),
    ).toMatchObject({ name: 'Inglés', subjectKey: 'ingles' });

    const grades = parsed.activities.flatMap((a) => a.grades);
    expect(grades).toHaveLength(600);
    // A 0 in the Excel is "no entregó".
    expect(grades.filter((g) => g.score === 0).every((g) => g.status === 'NOT_DELIVERED')).toBe(
      true,
    );
    expect(parsed.adjustments).toHaveLength(25);
    expect(parsed.observations).toHaveLength(20);
    expect(parsed.meta).toMatchObject({ group: '5°B', schoolYear: '2026 - 2027' });
    expect(parsed.issues.filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('reports the 14 of Ética / Lotería as out of range and does not import it', async () => {
    const buffer = await editedFixture((wb) => {
      const sheet = wb.getWorksheet('Ética')!;
      expect(sheet.getCell('I3').value).toBe('Lotería');
      sheet.getCell('I7').value = 14;
    });
    const parsed = await parseWorkbook(buffer);
    const issue = parsed.issues.find((i) => i.code === 'OUT_OF_RANGE');
    expect(issue).toMatchObject({ severity: 'error', sheet: 'Ética', cell: 'I7', listNumber: 3 });
    expect(issue?.message).toContain('14');
    const loteria = parsed.activities.find((a) => a.name === 'Lotería')!;
    expect(loteria.grades.map((g) => g.listNumber)).not.toContain(3);
    expect(loteria.pending).toEqual([3]);
  });

  it('warns about empty cells where the rest of the group has a grade', async () => {
    const buffer = await editedFixture((wb) => {
      wb.getWorksheet('Saberes')!.getCell('C9').value = null;
    });
    const parsed = await parseWorkbook(buffer);
    expect(parsed.issues).toContainEqual(
      expect.objectContaining({ severity: 'warning', code: 'PENDING_GRADES', sheet: 'Saberes' }),
    );
  });

  it('rejects files that are not the grades workbook', async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet('Hoja1');
    const buffer = Buffer.from(await wb.xlsx.writeBuffer());
    await expect(parseWorkbook(buffer)).rejects.toThrow(WorkbookReadError);
    await expect(parseWorkbook(Buffer.from('no es excel'))).rejects.toThrow(WorkbookReadError);
  });
});
