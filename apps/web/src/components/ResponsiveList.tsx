import { LoaderCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Card } from '@/components/ui/card';
import { cn } from '@/lib/utils';

export interface Column<T> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

interface ResponsiveListProps<T> {
  rows: T[] | undefined;
  rowKey: (row: T) => string;
  columns: Column<T>[];
  /** What a row looks like as a card on phones and tablets. */
  card: (row: T) => ReactNode;
  loading?: boolean;
  empty: ReactNode;
  label: string;
}

/** Table from 768 px; on phones each row becomes a card (mobile-first). */
export function ResponsiveList<T>({
  rows,
  rowKey,
  columns,
  card,
  loading,
  empty,
  label,
}: ResponsiveListProps<T>) {
  if (loading && !rows) {
    return (
      <div className="flex justify-center py-10" role="status">
        <LoaderCircle className="size-6 animate-spin text-primary" aria-hidden />
        <span className="sr-only">Cargando…</span>
      </div>
    );
  }
  if (!rows || rows.length === 0) {
    return <Card className="px-5 py-10 text-center text-sm text-muted-foreground">{empty}</Card>;
  }
  return (
    <>
      <ul className="flex flex-col gap-3 md:hidden" aria-label={label}>
        {rows.map((row) => (
          <li key={rowKey(row)}>
            <Card className="p-4">{card(row)}</Card>
          </li>
        ))}
      </ul>
      <Card className="hidden overflow-x-auto md:block">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">{label}</caption>
          <thead className="border-b border-border bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.header}
                  scope="col"
                  className={cn('px-4 py-3 font-medium', column.className)}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={rowKey(row)} className="border-b border-border last:border-0">
                {columns.map((column) => (
                  <td
                    key={column.header}
                    className={cn('px-4 py-3 align-middle', column.className)}
                  >
                    {column.cell(row)}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </>
  );
}
