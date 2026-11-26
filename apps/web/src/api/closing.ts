import type {
  PeriodGroupStatusView,
  PeriodResultRow,
  PeriodResultsView,
  UpdatePeriodResultInput,
} from '@siseep/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';
import { summaryKeys } from './summary';

export const closingKeys = {
  results: (groupId: string, periodId: string) =>
    ['groups', groupId, 'period-results', periodId] as const,
  statuses: (periodId: string) => ['periods', periodId, 'group-statuses'] as const,
};

/** Results of the group: live while OPEN / IN_REVIEW, the snapshot once CLOSED. */
export const usePeriodResults = (groupId: string, periodId: string | undefined) =>
  useQuery({
    queryKey: closingKeys.results(groupId, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () =>
      api.get<PeriodResultsView>(`/groups/${groupId}/period-results?periodId=${periodId}`),
  });

/** Saves one student's adjustments / observations / legend and patches the cached row. */
export function useUpdatePeriodResult(groupId: string, periodId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: UpdatePeriodResultInput }) =>
      api.patch<PeriodResultRow>(`/period-results/${id}`, input),
    onSuccess: async (row) => {
      queryClient.setQueryData<PeriodResultsView>(
        closingKeys.results(groupId, periodId),
        (view) => {
          if (!view) return view;
          const rows = view.rows.map((r) => (r.id === row.id ? row : r));
          return {
            ...view,
            rows,
            progress: {
              total: rows.length,
              withObservations: rows.filter(
                (r) =>
                  Boolean(r.observations.general) ||
                  Object.values(r.observations.byField).some(Boolean),
              ).length,
            },
          };
        },
      );
      await queryClient.invalidateQueries({ queryKey: summaryKeys.group(groupId, periodId) });
      toast.success('Guardado.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export type TransitionAction = 'review' | 'close' | 'publish' | 'reopen';

/** review / close / publish / reopen of one group in one period. */
export function usePeriodTransition() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({
      periodId,
      groupId,
      action,
      reason,
    }: {
      periodId: string;
      groupId: string;
      action: TransitionAction;
      reason?: string;
    }) =>
      api.post<PeriodGroupStatusView>(
        `/periods/${periodId}/groups/${groupId}/${action}`,
        action === 'reopen' ? { reason } : undefined,
      ),
    onSuccess: async (_status, { groupId, periodId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: closingKeys.results(groupId, periodId) }),
        queryClient.invalidateQueries({ queryKey: closingKeys.statuses(periodId) }),
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
      ]);
    },
  });
}

/** Status of every group in a period (admin). */
export const usePeriodGroupStatuses = (periodId: string | undefined) =>
  useQuery({
    queryKey: closingKeys.statuses(periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<PeriodGroupStatusView[]>(`/periods/${periodId}/groups`),
  });

/** HTML of the report cards for the preview (one student or the whole group). */
export async function fetchReportCardPreview(
  groupId: string,
  periodId: string,
  studentId?: string,
): Promise<string> {
  const blob = await api.blob(
    `/groups/${groupId}/report-cards.html?periodId=${periodId}${studentId ? `&studentId=${studentId}` : ''}`,
  );
  return blob.text();
}

/** Downloads "Boletas 5°B - Periodo I.pdf|docx". */
export async function downloadReportCards(
  groupId: string,
  periodId: string,
  format: 'pdf' | 'docx',
  fileName: string,
): Promise<void> {
  const blob = await api.blob(`/groups/${groupId}/report-cards.${format}?periodId=${periodId}`);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---- Teacher logo ("Mi cuenta") ---------------------------------------------------
export const myLogoKey = ['me', 'logo'] as const;

export const useMyLogo = (enabled: boolean) =>
  useQuery({
    queryKey: myLogoKey,
    enabled,
    queryFn: async () => URL.createObjectURL(await api.blob('/me/logo')),
    staleTime: Infinity,
    retry: false,
  });
