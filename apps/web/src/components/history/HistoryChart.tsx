import type { StudentHistory } from '@siseep/shared';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

/** One color per period (navy shades, readable on white and for color-blind users). */
const PERIOD_COLORS = ['#1F3A7A', '#5B7FC7', '#A9BCE6'];

const format = (value: number | null | undefined) =>
  value === null || value === undefined
    ? '—'
    : Number.isInteger(value)
      ? String(value)
      : value.toFixed(1);

/**
 * Grades per field in each period of the school year: grouped bars (field × period) and a
 * compact table. "en curso" marks periods that are not closed yet (live calculation).
 */
export function HistoryChart({
  history,
  title = 'Comparativo por periodo',
}: {
  history: StudentHistory;
  title?: string;
}) {
  const periods = history.periods.filter((p) => p.source !== 'none');
  if (periods.length === 0) {
    return (
      <Card className="p-4">
        <h2 className="mb-1 font-semibold">{title}</h2>
        <p className="text-sm text-muted-foreground">Aún no hay calificaciones en este ciclo.</p>
      </Card>
    );
  }
  const data = history.fields.map((field) => ({
    field: field.shortName,
    ...Object.fromEntries(periods.map((p) => [p.name, p.values[field.key] ?? null])),
  }));

  return (
    <Card className="p-4">
      <h2 className="mb-3 font-semibold">{title}</h2>
      <div
        className="h-60"
        role="img"
        aria-label={`Gráfica de barras: calificación por campo en ${periods.map((p) => p.name).join(' y ')}`}
      >
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={data} margin={{ top: 5, right: 8, bottom: 0, left: -20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="field" tick={{ fontSize: 11 }} interval={0} />
            <YAxis domain={[0, 10]} ticks={[0, 2, 4, 6, 8, 10]} tick={{ fontSize: 11 }} />
            <Tooltip
              formatter={(value) =>
                typeof value === 'number' ? format(value) : String(value ?? '')
              }
            />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            {periods.map((p, i) => (
              <Bar
                key={p.id}
                dataKey={p.name}
                fill={PERIOD_COLORS[i % PERIOD_COLORS.length]}
                radius={[3, 3, 0, 0]}
                isAnimationActive={false}
              />
            ))}
          </BarChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full text-sm">
          <caption className="sr-only">{title}</caption>
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted-foreground">
              <th scope="col" className="py-2 pr-2 font-medium">
                Campo
              </th>
              {periods.map((p) => (
                <th key={p.id} scope="col" className="px-2 py-2 text-center font-medium">
                  {p.name}
                  {p.source === 'live' ? <span className="block font-normal">en curso</span> : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {history.fields.map((field) => (
              <tr key={field.key} className="border-b border-border last:border-0">
                <th scope="row" className="py-2 pr-2 text-left font-normal">
                  <span className="flex items-center gap-2">
                    <span
                      className="size-2.5 shrink-0 rounded-full"
                      style={{ backgroundColor: field.color }}
                      aria-hidden
                    />
                    {field.shortName}
                  </span>
                </th>
                {periods.map((p) => {
                  const value = p.values[field.key];
                  return (
                    <td
                      key={p.id}
                      className={cn(
                        'px-2 py-2 text-center font-semibold tabular-nums',
                        value !== null && value !== undefined && value < 7 && 'text-amber-700',
                      )}
                    >
                      {format(value)}
                    </td>
                  );
                })}
              </tr>
            ))}
            {periods.some((p) => p.generalAverage !== null) ? (
              <tr>
                <th scope="row" className="py-2 pr-2 text-left font-medium">
                  Promedio general
                </th>
                {periods.map((p) => (
                  <td key={p.id} className="px-2 py-2 text-center font-semibold tabular-nums">
                    {format(p.generalAverage)}
                  </td>
                ))}
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
