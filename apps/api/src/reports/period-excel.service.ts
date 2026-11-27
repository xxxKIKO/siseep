import { Injectable } from '@nestjs/common';
import {
  type Component,
  FIELD_NAMES,
  FIELD_SHORT_NAMES,
  type FieldKey,
  PERIOD_GROUP_STATUS_LABELS,
  PRIMARY_COLOR,
} from '@siseep/shared';
import ExcelJS from 'exceljs';
import { PeriodResultsService } from '../closing/period-results.service';
import type { Actor } from '../common/request-user';
import { PeriodStatusService } from '../periods/period-status.service';
import { PeriodDataService } from '../summary/period-data.service';

const COMPONENT_NAMES: Record<Component, string> = {
  DESEMPENO: 'Desempeño',
  PROYECTO: 'Proyecto',
  EXAMEN: 'Examen',
  COMPLEMENTARIA: 'Complementaria',
};
const argb = (hex: string) => `FF${hex.replace('#', '').toUpperCase()}`;
const NAVY = argb(PRIMARY_COLOR);
const safe = (s: string) => s.replace(/[\\/:*?"<>|]+/g, '-');

function headerStyle(cell: ExcelJS.Cell, fill = NAVY, color = 'FFFFFFFF'): void {
  cell.font = { bold: true, color: { argb: color } };
  cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: fill } };
  cell.alignment = { vertical: 'middle', horizontal: 'center', wrapText: true };
  cell.border = {
    top: { style: 'thin', color: { argb: 'FFC9CFDB' } },
    bottom: { style: 'thin', color: { argb: 'FFC9CFDB' } },
    left: { style: 'thin', color: { argb: 'FFC9CFDB' } },
    right: { style: 'thin', color: { argb: 'FFC9CFDB' } },
  };
}

/**
 * Concentrado del periodo (stage 6) in Excel, like the "Resumen" sheet of the current workbook:
 * one summary sheet (calculated, rounded, adjustment and report-card grade per field, general
 * average, "Ojo en") and one sheet per field with every activity. Values come from the same
 * rows as the closing screen: the photo once closed, the live engine before that.
 */
@Injectable()
export class PeriodExcelService {
  constructor(
    private readonly results: PeriodResultsService,
    private readonly periodData: PeriodDataService,
    private readonly periodStatus: PeriodStatusService,
  ) {}

  async build(
    groupId: string,
    periodId: string,
    actor: Actor,
  ): Promise<{ buffer: Buffer; fileName: string }> {
    const { group, period } = await this.results.loadTarget(groupId, periodId, actor);
    const [data, status] = await Promise.all([
      this.periodData.load(group, period._id),
      this.periodStatus.effective(period._id, group._id),
    ]);
    const rows = this.results.rows(data, status);
    const fields = [...data.scheme.fields].sort((a, b) => a.order - b.order);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'SISEEP';
    workbook.created = new Date();

    // ---- Resumen --------------------------------------------------------------------
    const summary = workbook.addWorksheet('Resumen', {
      views: [{ state: 'frozen', xSplit: 2, ySplit: 3 }],
    });
    summary.getCell('A1').value = `Concentrado ${group.name} · ${period.name}`;
    summary.getCell('A1').font = { bold: true, size: 14, color: { argb: NAVY } };
    summary.getCell('A2').value = `Estado: ${PERIOD_GROUP_STATUS_LABELS[status]}${
      rows[0]?.source === 'snapshot' ? ' · valores de la foto del cierre' : ' · cálculo en vivo'
    }`;
    const header = ['N/L', 'Alumno'];
    for (const f of fields) {
      const short = FIELD_SHORT_NAMES[f.key as FieldKey];
      header.push(
        `${short}\nCalculada`,
        `${short}\nRedondeo`,
        `${short}\nAjuste`,
        `${short}\nBoleta`,
      );
    }
    header.push('Promedio\ngeneral', 'Ojo en');
    const headerRow = summary.getRow(3);
    header.forEach((title, i) => {
      const cell = headerRow.getCell(i + 1);
      cell.value = title;
      const field = i >= 2 ? fields[Math.floor((i - 2) / 4)] : undefined;
      if (field && i < 2 + fields.length * 4) headerStyle(cell, argb(field.color), 'FF1F2430');
      else headerStyle(cell);
    });
    headerRow.height = 32;
    rows.forEach((row, r) => {
      const values: (string | number | null)[] = [row.student.listNumber, row.student.fullName];
      for (const f of fields) {
        const result = row.fields.find((x) => x.fieldKey === f.key);
        values.push(
          result?.calculated ?? null,
          result?.rounded ?? null,
          result?.override ?? null,
          result?.final ?? null,
        );
      }
      values.push(row.generalAverage, row.legendOverride ?? row.legendSuggested ?? '');
      const excelRow = summary.getRow(4 + r);
      values.forEach((value, i) => {
        const cell = excelRow.getCell(i + 1);
        cell.value = value;
        const kind = (i - 2) % 4;
        if (i >= 2 && i < 2 + fields.length * 4) {
          cell.numFmt = kind === 0 ? '0.00' : '0';
          cell.alignment = { horizontal: 'center' };
          if (kind === 3) cell.font = { bold: true };
        }
        if (i === 2 + fields.length * 4) {
          cell.numFmt = '0.0';
          cell.font = { bold: true };
          cell.alignment = { horizontal: 'center' };
        }
        if (i === values.length - 1 && value) cell.font = { color: { argb: 'FFC0392B' } };
      });
    });
    summary.getColumn(1).width = 6;
    summary.getColumn(2).width = 36;
    for (let i = 3; i <= 2 + fields.length * 4; i++) summary.getColumn(i).width = 11;
    summary.getColumn(3 + fields.length * 4).width = 10;
    summary.getColumn(4 + fields.length * 4).width = 32;

    // ---- One sheet per field with its activities ---------------------------------------
    const gradeBy = new Map(
      data.grades.map((g) => [`${g.studentId.toString()}:${g.activityId.toString()}`, g]),
    );
    for (const f of fields) {
      const key = f.key as FieldKey;
      const sheet = workbook.addWorksheet(FIELD_SHORT_NAMES[key], {
        views: [{ state: 'frozen', xSplit: 2, ySplit: 2 }],
      });
      const activities = data.activities
        .filter((a) => a.fieldKey === key)
        .sort(
          (a, b) =>
            a.component.localeCompare(b.component) ||
            a.date.getTime() - b.date.getTime() ||
            a.name.localeCompare(b.name),
        );
      sheet.getCell('A1').value = `${FIELD_NAMES[key]} · ${group.name} · ${period.name}`;
      sheet.getCell('A1').font = { bold: true, size: 13, color: { argb: NAVY } };
      const head = sheet.getRow(2);
      const titles = [
        'N/L',
        'Alumno',
        ...activities.map(
          (a) => `${COMPONENT_NAMES[a.component]}\n${a.name}\n${a.date.toISOString().slice(0, 10)}`,
        ),
        'Desempeño',
        'Proyectos',
        'Exámenes',
        ...(f.complementary ? [f.complementary.name] : []),
        'Calculada',
        'Boleta',
      ];
      titles.forEach((title, i) => {
        const cell = head.getCell(i + 1);
        cell.value = title;
        headerStyle(
          cell,
          i >= 2 && i < 2 + activities.length ? argb(f.color) : NAVY,
          i >= 2 && i < 2 + activities.length ? 'FF1F2430' : 'FFFFFFFF',
        );
      });
      head.height = 60;
      data.rows.forEach(({ student, result }, r) => {
        const field = result.fields.find((x) => x.fieldKey === key);
        const final = rows
          .find((x) => x.student.id === student.id)
          ?.fields.find((x) => x.fieldKey === key);
        const values: (string | number | null)[] = [student.listNumber, student.fullName];
        for (const a of activities) {
          const g = gradeBy.get(`${student.id}:${a._id.toString()}`);
          values.push(
            !g
              ? null
              : g.status === 'NOT_DELIVERED'
                ? 'NE'
                : g.status === 'EXCUSED'
                  ? 'NA'
                  : (g.score ?? null),
          );
        }
        values.push(
          field?.components.DESEMPENO.value ?? null,
          field?.components.PROYECTO.value ?? null,
          field?.components.EXAMEN.value ?? null,
          ...(f.complementary ? [field?.complementary?.value ?? null] : []),
          final?.calculated ?? null,
          final?.final ?? null,
        );
        const excelRow = sheet.getRow(3 + r);
        values.forEach((value, i) => {
          const cell = excelRow.getCell(i + 1);
          cell.value = value;
          if (i >= 2) {
            cell.alignment = { horizontal: 'center' };
            if (i >= 2 + activities.length) cell.numFmt = i === values.length - 1 ? '0' : '0.00';
          }
        });
      });
      sheet.getColumn(1).width = 6;
      sheet.getColumn(2).width = 34;
      for (let i = 3; i <= titles.length; i++) sheet.getColumn(i).width = 12;
    }

    const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
    return { buffer, fileName: `Concentrado ${safe(group.name)} - ${safe(period.name)}.xlsx` };
  }
}
