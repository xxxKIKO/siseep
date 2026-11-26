import {
  AlignmentType,
  BorderStyle,
  Document,
  ImageRun,
  Packer,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableLayoutType,
  TableRow,
  TextRun,
  VerticalAlign,
  WidthType,
  type ISectionOptions,
  type ITableCellBorders,
} from 'docx';
import { PRIMARY_COLOR } from '@siseep/shared';
import type { StoredImage } from '../files/files.service';
import { imageSize, type ReportCard, type ReportCardData } from './report-card.data';

/** Letter size with 0.5 in margins, in DXA (1 in = 1440). */
const PAGE = { width: 12240, height: 15840, margin: 720 };
const CONTENT = PAGE.width - PAGE.margin * 2; // 10800
const NAVY = PRIMARY_COLOR.replace('#', '');
const FONT = 'Arial';

const NONE = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
const NO_BORDERS: ITableCellBorders = { top: NONE, bottom: NONE, left: NONE, right: NONE };
const GRID = { style: BorderStyle.SINGLE, size: 4, color: 'C9CFDB' };
const GRID_BORDERS: ITableCellBorders = { top: GRID, bottom: GRID, left: GRID, right: GRID };
const BOX = { style: BorderStyle.SINGLE, size: 10, color: '1F2430' };
const BOX_BORDERS: ITableCellBorders = { top: BOX, bottom: BOX, left: BOX, right: BOX };

const text = (
  value: string,
  options: Partial<{ bold: boolean; size: number; color: string; italics: boolean }> = {},
) => new TextRun({ text: value, font: FONT, size: options.size ?? 20, ...options });

const para = (
  runs: TextRun[] | string,
  options: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number } = {},
) =>
  new Paragraph({
    alignment: options.align ?? AlignmentType.LEFT,
    spacing: { after: options.after ?? 0, before: 0 },
    children: typeof runs === 'string' ? [text(runs)] : runs,
  });

function cell(
  width: number,
  children: Paragraph[],
  options: {
    fill?: string;
    borders?: ITableCellBorders;
    columnSpan?: number;
  } = {},
): TableCell {
  return new TableCell({
    width: { size: width, type: WidthType.DXA },
    verticalAlign: VerticalAlign.CENTER,
    borders: options.borders ?? GRID_BORDERS,
    margins: { top: 60, bottom: 60, left: 80, right: 80 },
    ...(options.columnSpan ? { columnSpan: options.columnSpan } : {}),
    ...(options.fill
      ? { shading: { type: ShadingType.CLEAR, color: 'auto', fill: options.fill } }
      : {}),
    children,
  });
}

function logo(image: StoredImage | null): Paragraph {
  if (!image) return para('', { align: AlignmentType.CENTER });
  const size = imageSize(image.buffer) ?? { width: 100, height: 100 };
  const max = 110; // px ≈ 1.15 in
  const scale = Math.min(max / size.width, max / size.height);
  return new Paragraph({
    alignment: AlignmentType.CENTER,
    children: [
      new ImageRun({
        type: image.contentType === 'image/png' ? 'png' : 'jpg',
        data: image.buffer,
        transformation: {
          width: Math.round(size.width * scale),
          height: Math.round(size.height * scale),
        },
      }),
    ],
  });
}

function header(data: ReportCardData): Table {
  const side = 1900;
  const center = CONTENT - side * 2;
  const lines = [
    para([text(data.schoolName.toUpperCase(), { bold: true, size: 28, color: NAVY })], {
      align: AlignmentType.CENTER,
      after: 60,
    }),
    para([text('Resultados individuales · Evaluación formativa', { bold: true, size: 22 })], {
      align: AlignmentType.CENTER,
      after: 60,
    }),
    para(`${data.periodName} · Ciclo escolar ${data.schoolYear}`, { align: AlignmentType.CENTER }),
    para(`Grupo ${data.groupName}${data.teacherName ? ` · ${data.teacherName}` : ''}`, {
      align: AlignmentType.CENTER,
    }),
    ...(data.placeDate ? [para(data.placeDate, { align: AlignmentType.CENTER })] : []),
  ];
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [side, center, side],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        height: { value: 2270, rule: 'atLeast' }, // ~4 cm
        children: [
          cell(side, [logo(data.schoolLogo)], { borders: NO_BORDERS }),
          cell(center, lines, { borders: NO_BORDERS }),
          cell(side, [logo(data.teacherLogo)], { borders: NO_BORDERS }),
        ],
      }),
    ],
  });
}

function studentStrip(card: ReportCard): Table {
  const left = CONTENT - 2000;
  const border = {
    ...NO_BORDERS,
    left: { style: BorderStyle.SINGLE, size: 36, color: NAVY },
  };
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [left, 2000],
    layout: TableLayoutType.FIXED,
    rows: [
      new TableRow({
        children: [
          cell(
            left,
            [para([text('Alumno(a): ', { size: 22 }), text(card.name, { bold: true, size: 22 })])],
            {
              fill: 'EEF2FA',
              borders: border,
            },
          ),
          cell(
            2000,
            [
              para(
                [
                  text('N/L ', { size: 22 }),
                  text(String(card.listNumber), { bold: true, size: 22 }),
                ],
                { align: AlignmentType.RIGHT },
              ),
            ],
            { fill: 'EEF2FA', borders: NO_BORDERS },
          ),
        ],
      }),
    ],
  });
}

const COLUMNS = [2700, 1050, 1050, 1050, 1100, 1100, 1100, 1650]; // = 10800
const HEADERS = [
  'Campo formativo',
  'Desempeño (50%)',
  'Proyectos (20%)',
  'Exámenes (30%)',
  'Promedio del campo',
  'Inglés / Ed. Física',
  'Promedio final',
  'Calificación',
];

function gradesTable(card: ReportCard): Table {
  const head = new TableRow({
    tableHeader: true,
    children: HEADERS.map((title, i) =>
      cell(
        COLUMNS[i]!,
        [
          para([text(title, { bold: true, size: 17, color: 'FFFFFF' })], {
            align: AlignmentType.CENTER,
          }),
        ],
        {
          fill: NAVY,
          borders: {
            top: { ...GRID, color: NAVY },
            bottom: { ...GRID, color: NAVY },
            left: { ...GRID, color: NAVY },
            right: { ...GRID, color: NAVY },
          },
        },
      ),
    ),
  });
  const rows = card.fields.map(
    (f) =>
      new TableRow({
        children: [
          cell(COLUMNS[0]!, [para([text(f.name, { bold: true, size: 19 })])], {
            borders: {
              ...GRID_BORDERS,
              left: { style: BorderStyle.SINGLE, size: 48, color: f.color.replace('#', '') },
            },
          }),
          ...[f.desempeno, f.proyecto, f.examen, f.base, f.complementary, f.calculated].map(
            (value, i) =>
              cell(COLUMNS[i + 1]!, [
                para([text(value, { bold: i === 3 || i === 5 })], { align: AlignmentType.CENTER }),
              ]),
          ),
          cell(COLUMNS[7]!, [
            para(
              [text(`${f.final}${f.adjusted ? '*' : ''}`, { bold: true, size: 34, color: NAVY })],
              {
                align: AlignmentType.CENTER,
              },
            ),
          ]),
        ],
      }),
  );
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: COLUMNS,
    layout: TableLayoutType.FIXED,
    rows: [head, ...rows],
  });
}

function boxed(title: string, children: Paragraph[]): Table {
  return new Table({
    width: { size: CONTENT, type: WidthType.DXA },
    columnWidths: [CONTENT],
    rows: [
      new TableRow({
        children: [
          cell(
            CONTENT,
            [
              para([text(title.toUpperCase(), { bold: true, color: NAVY })], { after: 80 }),
              ...children,
            ],
            { borders: BOX_BORDERS },
          ),
        ],
      }),
    ],
  });
}

const spacer = (after = 160) => new Paragraph({ spacing: { after, before: 0 }, children: [] });

function cardSection(data: ReportCardData, card: ReportCard): ISectionOptions {
  const line = () =>
    new Paragraph({
      spacing: { before: 0, after: 200 },
      border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: '6B7385', space: 1 } },
      children: [],
    });
  return {
    properties: {
      page: {
        size: { width: PAGE.width, height: PAGE.height },
        margin: { top: PAGE.margin, bottom: PAGE.margin, left: PAGE.margin, right: PAGE.margin },
      },
    },
    children: [
      ...(data.draft
        ? [
            para(
              [text('BORRADOR · el periodo aún no está cerrado', { bold: true, color: 'C0392B' })],
              { align: AlignmentType.CENTER, after: 80 },
            ),
          ]
        : []),
      header(data),
      spacer(120),
      studentStrip(card),
      spacer(120),
      gradesTable(card),
      new Paragraph({
        spacing: { before: 120, after: 160 },
        tabStops: [{ type: 'right', position: CONTENT }],
        children: [
          text(card.anyAdjusted ? '* Calificación ajustada por la maestra.' : '', {
            italics: true,
            size: 18,
          }),
          new TextRun({ text: '\tPromedio general  ', font: FONT, size: 22 }),
          text(card.generalAverage, { bold: true, size: 32, color: NAVY }),
        ],
      }),
      boxed(
        'Observaciones',
        card.observations.length
          ? card.observations.map((o) =>
              para([text(`${o.label}: `, { bold: true }), text(o.text)], { after: 80 }),
            )
          : [para([text('Sin observaciones.', { italics: true, color: '8A90A0' })])],
      ),
      spacer(),
      ...(card.legend
        ? [para([text(card.legend, { bold: true, size: 22, color: 'C0392B' })], { after: 160 })]
        : []),
      boxed('Compromisos de padres de familia', [line(), line(), line(), line()]),
      spacer(900),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        indent: { left: 3000, right: 3000 },
        border: { top: { style: BorderStyle.SINGLE, size: 6, color: '1F2430', space: 4 } },
        children: [text('Nombre y firma de padre, madre o tutor', { size: 19 })],
      }),
    ],
  };
}

/** One section per student, so each report card starts on its own page. */
export async function buildReportCardsDocx(data: ReportCardData): Promise<Buffer> {
  const doc = new Document({
    creator: 'SISEEP',
    title: `Boletas ${data.groupName} - ${data.periodName}`,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections: data.cards.map((card) => cardSection(data, card)),
  });
  return Packer.toBuffer(doc);
}
