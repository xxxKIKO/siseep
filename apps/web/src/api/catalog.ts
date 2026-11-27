import type {
  ActivityView,
  CreateAssignmentInput,
  CreateEnrollmentInput,
  CreateGroupInput,
  CreatePeriodInput,
  CreatePermissionGrantInput,
  CreateSchoolYearInput,
  CreateStaffInvitationInput,
  CreateStudentInput,
  GradingScheme,
  GroupView,
  ImportCommitResult,
  ImportPreview,
  Paginated,
  PeriodView,
  PermissionGrantView,
  RosterEntry,
  SchoolView,
  SchoolYearView,
  StudentView,
  UpdateEnrollmentInput,
  UpdatePeriodInput,
  UpdateSchoolInput,
  UpdateSchoolYearInput,
  UpdateStudentInput,
  UpdateUserInput,
  User,
} from '@siseep/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';

export const keys = {
  school: ['school'] as const,
  schoolLogo: ['school', 'logo'] as const,
  years: ['school-years'] as const,
  scheme: (yearId: string) => ['school-years', yearId, 'grading-scheme'] as const,
  periods: (yearId?: string) => ['periods', yearId ?? 'all'] as const,
  groups: ['groups'] as const,
  group: (id: string) => ['groups', id] as const,
  roster: (id: string) => ['groups', id, 'roster'] as const,
  activities: (groupId: string, periodId: string) =>
    ['groups', groupId, 'activities', periodId] as const,
  students: (params: string) => ['students', params] as const,
  users: (params: string) => ['users', params] as const,
  invitations: ['invitations'] as const,
  grants: ['permission-grants'] as const,
};

/** Mutation with Spanish success/error toasts and cache invalidation. */
function useAction<TInput, TResult>(
  fn: (input: TInput) => Promise<TResult>,
  options: { success?: string; invalidate?: readonly (readonly unknown[])[] } = {},
) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: async () => {
      await Promise.all(
        (options.invalidate ?? []).map((queryKey) => queryClient.invalidateQueries({ queryKey })),
      );
      if (options.success) toast.success(options.success);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
}

// ---- School ----------------------------------------------------------------
export const useSchool = () =>
  useQuery({ queryKey: keys.school, queryFn: () => api.get<SchoolView>('/school') });

export const useSchoolLogo = (enabled: boolean) =>
  useQuery({
    queryKey: keys.schoolLogo,
    enabled,
    queryFn: async () => URL.createObjectURL(await api.blob('/school/logo')),
    staleTime: Infinity,
  });

export const useUpdateSchool = () =>
  useAction((input: UpdateSchoolInput) => api.patch<SchoolView>('/school', input), {
    success: 'Datos de la escuela guardados.',
    invalidate: [keys.school],
  });

export const useUploadLogo = () =>
  useAction(
    (file: File) => {
      const form = new FormData();
      form.append('file', file);
      return api.upload<SchoolView>('/school/logo', form, 'PUT');
    },
    { success: 'Logo actualizado.', invalidate: [keys.school, keys.schoolLogo] },
  );

// ---- School years, periods, grading scheme --------------------------------------
export const useSchoolYears = () =>
  useQuery({ queryKey: keys.years, queryFn: () => api.get<SchoolYearView[]>('/school-years') });

export const useCreateSchoolYear = () =>
  useAction((input: CreateSchoolYearInput) => api.post<SchoolYearView>('/school-years', input), {
    success: 'Ciclo escolar creado con las reglas de cálculo por defecto.',
    invalidate: [keys.years],
  });

export const useUpdateSchoolYear = () =>
  useAction(
    ({ id, ...input }: UpdateSchoolYearInput & { id: string }) =>
      api.patch<SchoolYearView>(`/school-years/${id}`, input),
    { success: 'Ciclo escolar actualizado.', invalidate: [keys.years, keys.groups] },
  );

export const usePeriods = (schoolYearId?: string) =>
  useQuery({
    queryKey: keys.periods(schoolYearId),
    queryFn: () =>
      api.get<PeriodView[]>(`/periods${schoolYearId ? `?schoolYearId=${schoolYearId}` : ''}`),
  });

export const useCreatePeriod = () =>
  useAction((input: CreatePeriodInput) => api.post<PeriodView>('/periods', input), {
    success: 'Periodo creado.',
    invalidate: [['periods'], keys.groups],
  });

export const useUpdatePeriod = () =>
  useAction(
    ({ id, ...input }: UpdatePeriodInput & { id: string }) =>
      api.patch<PeriodView>(`/periods/${id}`, input),
    { success: 'Periodo actualizado.', invalidate: [['periods'], keys.groups] },
  );

export const useGradingScheme = (yearId: string) =>
  useQuery({
    queryKey: keys.scheme(yearId),
    queryFn: () => api.get<GradingScheme>(`/school-years/${yearId}/grading-scheme`),
  });

export const useSaveGradingScheme = (yearId: string) =>
  useAction(
    (input: GradingScheme) =>
      api.put<GradingScheme>(`/school-years/${yearId}/grading-scheme`, input),
    {
      success: 'Reglas de cálculo guardadas.',
      invalidate: [keys.scheme(yearId)],
    },
  );

// ---- Groups ------------------------------------------------------------------
export const useGroups = () =>
  useQuery({ queryKey: keys.groups, queryFn: () => api.get<GroupView[]>('/groups') });

export const useGroup = (id: string) =>
  useQuery({ queryKey: keys.group(id), queryFn: () => api.get<GroupView>(`/groups/${id}`) });

export const useRoster = (id: string) =>
  useQuery({
    queryKey: keys.roster(id),
    queryFn: () => api.get<RosterEntry[]>(`/groups/${id}/roster`),
  });

export const useGroupActivities = (groupId: string, periodId: string | undefined) =>
  useQuery({
    queryKey: keys.activities(groupId, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<ActivityView[]>(`/groups/${groupId}/activities?periodId=${periodId}`),
  });

export const useCreateGroup = () =>
  useAction((input: CreateGroupInput) => api.post<GroupView>('/groups', input), {
    success: 'Grupo creado.',
    invalidate: [keys.groups],
  });

export const useAddAssignment = (groupId: string) =>
  useAction(
    (input: CreateAssignmentInput) => api.post<GroupView>(`/groups/${groupId}/assignments`, input),
    {
      success: 'Maestro asignado.',
      invalidate: [keys.groups],
    },
  );

export const useRemoveAssignment = (groupId: string) =>
  useAction(
    (assignmentId: string) =>
      api.delete<GroupView>(`/groups/${groupId}/assignments/${assignmentId}`),
    { success: 'Asignación quitada.', invalidate: [keys.groups] },
  );

// ---- Students ------------------------------------------------------------------
export const useStudents = (params: { q?: string; page?: number; groupId?: string }) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.groupId) search.set('groupId', params.groupId);
  search.set('page', String(params.page ?? 1));
  search.set('limit', '30');
  const query = search.toString();
  return useQuery({
    queryKey: keys.students(query),
    queryFn: () => api.get<Paginated<StudentView>>(`/students?${query}`),
    placeholderData: (previous) => previous,
  });
};

export const useCreateStudent = () =>
  useAction((input: CreateStudentInput) => api.post<StudentView>('/students', input), {
    success: 'Alumno dado de alta.',
    invalidate: [['students']],
  });

export const useUpdateStudent = () =>
  useAction(
    ({ id, ...input }: UpdateStudentInput & { id: string }) =>
      api.patch<StudentView>(`/students/${id}`, input),
    { success: 'Datos del alumno guardados.', invalidate: [['students'], keys.groups] },
  );

export const useEnroll = () =>
  useAction((input: CreateEnrollmentInput) => api.post<StudentView>('/enrollments', input), {
    success: 'Alumno inscrito.',
    invalidate: [['students'], keys.groups],
  });

export const useUpdateEnrollment = () =>
  useAction(
    ({ id, ...input }: UpdateEnrollmentInput & { id: string }) =>
      api.patch<StudentView>(`/enrollments/${id}`, input),
    { success: 'Inscripción actualizada.', invalidate: [['students'], keys.groups] },
  );

// ---- Users, invitations, grants ---------------------------------------------------
export const useUsers = (params: { q?: string; role?: string; page?: number; limit?: number }) => {
  const search = new URLSearchParams();
  if (params.q) search.set('q', params.q);
  if (params.role) search.set('role', params.role);
  search.set('page', String(params.page ?? 1));
  search.set('limit', String(params.limit ?? 50));
  const query = search.toString();
  return useQuery({
    queryKey: keys.users(query),
    queryFn: () => api.get<Paginated<User>>(`/users?${query}`),
    placeholderData: (previous) => previous,
  });
};

export const useUpdateUser = () =>
  useAction(
    ({ id, ...input }: UpdateUserInput & { id: string }) => api.patch<User>(`/users/${id}`, input),
    {
      success: 'Cambios guardados.',
      invalidate: [['users']],
    },
  );

export const useUserAction = (action: 'disable' | 'enable') =>
  useAction((id: string) => api.post<User>(`/users/${id}/${action}`), {
    success:
      action === 'disable' ? 'Cuenta desactivada y sesiones cerradas.' : 'Cuenta reactivada.',
    invalidate: [['users']],
  });

export const usePendingInvitations = () =>
  useQuery({
    queryKey: keys.invitations,
    queryFn: () =>
      api.get<{ id: string; email: string; roles: string[]; expiresAt: string }[]>('/invitations'),
  });

export const useInviteStaff = () =>
  useAction((input: CreateStaffInvitationInput) => api.post('/invitations/staff', input), {
    success: 'Invitación enviada por correo.',
    invalidate: [keys.invitations],
  });

export const useGrants = () =>
  useQuery({
    queryKey: keys.grants,
    queryFn: () => api.get<PermissionGrantView[]>('/permission-grants'),
  });

export const useCreateGrant = () =>
  useAction(
    (input: CreatePermissionGrantInput) =>
      api.post<PermissionGrantView>('/permission-grants', input),
    {
      success: 'Permiso otorgado.',
      invalidate: [keys.grants],
    },
  );

export const useRevokeGrant = () =>
  useAction((id: string) => api.delete(`/permission-grants/${id}`), {
    success: 'Permiso revocado.',
    invalidate: [keys.grants],
  });

// ---- Import ---------------------------------------------------------------------
export const useImportPreview = () =>
  useMutation({
    mutationFn: (input: { file: File; groupId: string; periodId: string }) => {
      const form = new FormData();
      form.append('groupId', input.groupId);
      form.append('periodId', input.periodId);
      form.append('file', input.file);
      return api.upload<ImportPreview>('/imports/excel/preview', form);
    },
    onError: (error) => toast.error(errorMessage(error)),
  });

export const useImportCommit = () =>
  useAction(
    (previewId: string) => api.post<ImportCommitResult>('/imports/excel/commit', { previewId }),
    {
      invalidate: [keys.groups, ['students']],
    },
  );
