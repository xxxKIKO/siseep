import type {
  AuditLogView,
  AuthResponse,
  ChildActivity,
  ChildNote,
  ChildOverview,
  ChildReportCard,
  ChildView,
  GroupGuardianRow,
  GuardianCodePreview,
  GuardianInvitationView,
  GuardianLinkView,
  Paginated,
  PrivacyNoticeView,
  RedeemGuardianCodeInput,
  RegisterGuardianInput,
  StudentHistory,
} from '@siseep/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';

export const guardianKeys = {
  group: (groupId: string) => ['groups', groupId, 'guardian-invitations'] as const,
  children: ['me', 'children'] as const,
  overview: (id: string, periodId: string) => ['me', 'children', id, 'overview', periodId] as const,
  activities: (id: string, periodId: string) =>
    ['me', 'children', id, 'activities', periodId] as const,
  notes: (id: string, periodId: string) => ['me', 'children', id, 'notes', periodId] as const,
  reportCards: (id: string) => ['me', 'children', id, 'report-cards'] as const,
  privacy: ['privacy-notice'] as const,
  studentGuardians: (studentId: string) => ['students', studentId, 'guardians'] as const,
};

/** Shared download helper (a link with the file name). */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

// ---- teacher: "Padres de familia" ------------------------------------------------------
export const useGroupGuardians = (groupId: string) =>
  useQuery({
    queryKey: guardianKeys.group(groupId),
    queryFn: () => api.get<GroupGuardianRow[]>(`/groups/${groupId}/guardian-invitations`),
  });

export function useCreateGuardianCode(groupId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (studentId: string) =>
      api.post<GuardianInvitationView>('/invitations/guardian', { studentId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: guardianKeys.group(groupId) }),
    onError: (error) => toast.error(errorMessage(error)),
  });
}

/** Strips to cut, with NEW codes (default: students without a linked guardian). */
export async function printGuardianCodes(
  groupId: string,
  groupName: string,
  studentIds?: string[],
): Promise<void> {
  const blob = await api.blob(`/groups/${groupId}/guardian-codes.pdf`, {
    method: 'POST',
    body: { studentIds },
  });
  saveBlob(blob, `Códigos para padres ${groupName}.pdf`);
}

// ---- public: sign-up and privacy notice -------------------------------------------------
export const usePrivacyNotice = () =>
  useQuery({
    queryKey: guardianKeys.privacy,
    queryFn: () => api.get<PrivacyNoticeView>('/school/privacy-notice', { auth: false }),
    staleTime: 5 * 60_000,
  });

export const previewGuardianCode = (code: string) =>
  api.post<GuardianCodePreview>('/auth/guardian-code', { code }, { auth: false });

export const registerGuardian = (input: RegisterGuardianInput) =>
  api.post<AuthResponse>('/auth/register-guardian', input, { auth: false });

// ---- guardian portal --------------------------------------------------------------------
export const useChildren = (enabled = true) =>
  useQuery({
    queryKey: guardianKeys.children,
    enabled,
    queryFn: () => api.get<ChildView[]>('/me/children'),
  });

export function useRedeemCode() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: RedeemGuardianCodeInput) => api.post<ChildView[]>('/me/children', input),
    onSuccess: (children) => queryClient.setQueryData(guardianKeys.children, children),
  });
}

export const useChildOverview = (id: string, periodId: string | undefined) =>
  useQuery({
    queryKey: guardianKeys.overview(id, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<ChildOverview>(`/me/children/${id}/overview?periodId=${periodId}`),
  });

export const useChildActivities = (id: string, periodId: string | undefined) =>
  useQuery({
    queryKey: guardianKeys.activities(id, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<ChildActivity[]>(`/me/children/${id}/activities?periodId=${periodId}`),
  });

export const useChildNotes = (id: string, periodId: string | undefined) =>
  useQuery({
    queryKey: guardianKeys.notes(id, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<ChildNote[]>(`/me/children/${id}/notes?periodId=${periodId}`),
  });

export const useChildReportCards = (id: string) =>
  useQuery({
    queryKey: guardianKeys.reportCards(id),
    queryFn: () => api.get<ChildReportCard[]>(`/me/children/${id}/report-cards`),
  });

export async function downloadChildReportCard(
  id: string,
  periodId: string,
  fileName: string,
): Promise<void> {
  const blob = await api.blob(`/me/children/${id}/report-card.pdf?periodId=${periodId}`);
  saveBlob(blob, fileName);
}

// ---- admin: guardians of a student; privacy notice ---------------------------------------
export const useStudentGuardians = (studentId: string, enabled = true) =>
  useQuery({
    queryKey: guardianKeys.studentGuardians(studentId),
    enabled,
    queryFn: () => api.get<GuardianLinkView[]>(`/students/${studentId}/guardians`),
  });

export function useRevokeGuardian(studentId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (linkId: string) => api.delete<void>(`/guardian-links/${linkId}`),
    onSuccess: async () => {
      await queryClient.invalidateQueries({
        queryKey: guardianKeys.studentGuardians(studentId),
      });
      toast.success('Tutor desvinculado.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

export function useUpdatePrivacyNotice() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (text: string) => api.put<PrivacyNoticeView>('/school/privacy-notice', { text }),
    onSuccess: (notice) => {
      queryClient.setQueryData(guardianKeys.privacy, notice);
      toast.success(`Aviso de privacidad guardado (versión ${notice.version}).`);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ---- director: audit log -------------------------------------------------------------------
export interface AuditFilters {
  entity?: string;
  groupId?: string;
  actorId?: string;
  from?: string;
  to?: string;
  page: number;
}

export const useAuditLog = (filters: AuditFilters) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  params.set('limit', '25');
  return useQuery({
    queryKey: ['audit', params.toString()],
    queryFn: () => api.get<Paginated<AuditLogView>>(`/audit?${params.toString()}`),
    placeholderData: (previous) => previous,
  });
};

export const useChildHistory = (id: string) =>
  useQuery({
    queryKey: ['me', 'children', id, 'history'],
    queryFn: () => api.get<StudentHistory>(`/me/children/${id}/history`),
  });
