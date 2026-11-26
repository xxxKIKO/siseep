import type { GroupOverview, GroupSummary, StudentSummaryView } from '@siseep/shared';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api-client';

export const summaryKeys = {
  group: (groupId: string, periodId: string) => ['groups', groupId, 'summary', periodId] as const,
  student: (studentId: string, periodId: string) =>
    ['students', studentId, 'summary', periodId] as const,
  dashboard: ['dashboard', 'groups'] as const,
};

/** Live averages of the group (the API caches 30 s and invalidates on every save). */
export const useGroupSummary = (groupId: string, periodId: string | undefined) =>
  useQuery({
    queryKey: summaryKeys.group(groupId, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<GroupSummary>(`/groups/${groupId}/summary?periodId=${periodId}`),
    staleTime: 15_000,
  });

export const useStudentSummary = (
  studentId: string,
  periodId: string | undefined,
  enabled = true,
) =>
  useQuery({
    queryKey: summaryKeys.student(studentId, periodId ?? ''),
    enabled: enabled && Boolean(periodId),
    queryFn: () =>
      api.get<StudentSummaryView>(`/students/${studentId}/summary?periodId=${periodId}`),
    staleTime: 15_000,
  });

export const useDashboard = () =>
  useQuery({
    queryKey: summaryKeys.dashboard,
    queryFn: () => api.get<GroupOverview[]>('/dashboard/groups'),
    staleTime: 30_000,
  });
