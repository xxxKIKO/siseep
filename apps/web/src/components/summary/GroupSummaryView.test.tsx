import {
  DEFAULT_GRADING_SCHEME,
  type EngineActivity,
  FIELD_SHORT_NAMES,
  type GroupSummary,
  studentPeriodResult,
} from '@siseep/shared';
import { render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { GroupSummaryView } from './GroupSummaryView';

const activities: EngineActivity[] = [
  { id: 'd', fieldKey: 'saberes', component: 'DESEMPENO' },
  { id: 'p', fieldKey: 'saberes', component: 'PROYECTO' },
  { id: 'e', fieldKey: 'saberes', component: 'EXAMEN' },
  { id: 'e2', fieldKey: 'etica', component: 'DESEMPENO' },
];

function summaryWith(): GroupSummary {
  // Ana: Saberes 5 (red). Beto: Ética only desempeño 6.5 (amber, partial).
  const ana = studentPeriodResult(DEFAULT_GRADING_SCHEME, activities, [
    { activityId: 'd', status: 'SCORED', score: 5 },
    { activityId: 'p', status: 'SCORED', score: 5 },
    { activityId: 'e', status: 'SCORED', score: 5 },
  ]);
  const beto = studentPeriodResult(DEFAULT_GRADING_SCHEME, activities, [
    { activityId: 'e2', status: 'SCORED', score: 6.5 },
  ]);
  return {
    group: { id: 'g', name: '5°B' },
    period: { id: 'p1', name: 'Periodo I', status: 'OPEN' },
    generatedAt: '2026-11-26T18:00:00.000Z',
    fields: DEFAULT_GRADING_SCHEME.fields.map((f) => ({
      key: f.key,
      name: f.name,
      shortName: FIELD_SHORT_NAMES[f.key],
      color: f.color,
    })),
    students: [
      {
        student: { id: 's1', listNumber: 1, fullName: 'Ana Uno', shortName: 'Ana Uno' },
        result: ana,
      },
      {
        student: { id: 's2', listNumber: 2, fullName: 'Beto Dos', shortName: 'Beto Dos' },
        result: beto,
      },
    ],
    stats: {
      byField: DEFAULT_GRADING_SCHEME.fields.map((f) => ({
        fieldKey: f.key,
        average: f.key === 'saberes' ? 5 : f.key === 'etica' ? 6.5 : null,
        finalAverage: null,
        distribution: { lt6: 0, '6': 0, '7': 0, '8': 0, '9': 0, '10': 0 },
        lowCount: f.key === 'saberes' || f.key === 'etica' ? 1 : 0,
      })),
      generalAverage: 5.5,
      studentsWithAlerts: 2,
    },
    alerts: [
      { studentId: 's1', fieldKey: 'saberes', type: 'LOW_6', value: 5 },
      { studentId: 's2', fieldKey: 'etica', type: 'LOW_7', value: 6.5 },
      { studentId: 's2', fieldKey: 'etica', type: 'PARTIAL', value: 6.5 },
    ],
    pendingActivities: [
      {
        activityId: 'e',
        name: 'Examen de fracciones',
        fieldKey: 'saberes',
        component: 'EXAMEN',
        date: '2026-11-20',
        pending: 1,
      },
    ],
    capture: { activities: 4, expected: 8, captured: 4, percent: 50 },
  };
}

const renderView = (readOnly = false) =>
  render(
    <MemoryRouter>
      <GroupSummaryView
        summary={summaryWith()}
        readOnly={readOnly}
        studentHref={(id) => `/maestro/grupos/g/alumnos/${id}`}
      />
    </MemoryRouter>,
  );

describe('GroupSummaryView', () => {
  it('lists students with low fields and activities with pending grades under "Atención"', () => {
    renderView();
    expect(screen.getByRole('heading', { name: /Atención/ })).toBeInTheDocument();
    expect(screen.getByText('Alumnos con campos bajos (2)')).toBeInTheDocument();
    const pending = screen.getByRole('link', { name: /Examen de fracciones/ });
    expect(pending).toHaveAttribute('href', '/maestro/actividades/e');
  });

  it('read-only (director) does not link to capture', () => {
    renderView(true);
    expect(screen.getByText('Examen de fracciones')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Examen de fracciones/ })).not.toBeInTheDocument();
  });

  it('colors the phone chips: red below 6, amber below 7, and marks partial', () => {
    renderView();
    const cards = screen.getByRole('list', { name: 'Promedios por alumno' });
    const ana = within(cards).getByText('1. Ana Uno').closest('li')!;
    const anaSaberes = within(ana).getByText('Saberes').closest('div')!;
    expect(anaSaberes.className).toContain('bg-red-50');
    expect(within(anaSaberes).getByText(/5\.0/)).toBeInTheDocument();

    const beto = within(cards).getByText('2. Beto Dos').closest('li')!;
    const betoEtica = within(beto).getByText('Ética').closest('div')!;
    expect(betoEtica.className).toContain('bg-amber-50');
    expect(within(betoEtica).getByText('parcial')).toBeInTheDocument();
  });
});
