import type {
  ActivityGradesView,
  ActivityView,
  CreateActivityInput,
  CreateNoteInput,
  NoteView,
  StudentGradesView,
  UpdateActivityInput,
  UpdateNoteInput,
} from '@siseep/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';

export const captureKeys = {
  activities: (groupId: string, periodId: string) =>
    ['groups', groupId, 'activities', periodId] as const,
  activity: (id: string) => ['activities', id] as const,
  grades: (activityId: string) => ['activities', activityId, 'grades'] as const,
  studentGrades: (studentId: string, periodId: string) =>
    ['students', studentId, 'grades', periodId] as const,
  studentNotes: (studentId: string) => ['students', studentId, 'notes'] as const,
  groupNotes: (groupId: string, date: string) => ['groups', groupId, 'notes', date] as const,
};

export const useActivities = (groupId: string, periodId: string | undefined) =>
  useQuery({
    queryKey: captureKeys.activities(groupId, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<ActivityView[]>(`/groups/${groupId}/activities?periodId=${periodId}`),
  });

export const useActivityGrades = (activityId: string) =>
  useQuery({
    queryKey: captureKeys.grades(activityId),
    queryFn: () => api.get<ActivityGradesView>(`/activities/${activityId}/grades`),
    staleTime: 0,
    // The capture screen keeps its own state; do not overwrite it in the background.
    refetchOnReconnect: false,
  });

export const useCreateActivity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateActivityInput) => api.post<ActivityView>('/activities', input),
    onSuccess: (activity) =>
      queryClient.invalidateQueries({
        queryKey: captureKeys.activities(activity.groupId, activity.periodId),
      }),
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useUpdateActivity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateActivityInput & { id: string }) =>
      api.patch<ActivityView>(`/activities/${id}`, input),
    onSuccess: async (activity) => {
      await queryClient.invalidateQueries({ queryKey: ['groups', activity.groupId, 'activities'] });
      toast.success('Actividad actualizada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useDeleteActivity = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, force }: { id: string; groupId: string; force?: boolean }) =>
      api.delete<void>(`/activities/${id}${force ? '?force=true' : ''}`),
    onSuccess: async (_data, { groupId }) => {
      await queryClient.invalidateQueries({ queryKey: ['groups', groupId, 'activities'] });
      toast.success('Actividad borrada.');
    },
  });
};

export const useStudentGrades = (studentId: string, periodId: string | undefined) =>
  useQuery({
    queryKey: captureKeys.studentGrades(studentId, periodId ?? ''),
    enabled: Boolean(periodId),
    queryFn: () => api.get<StudentGradesView>(`/students/${studentId}/grades?periodId=${periodId}`),
  });

export const useStudentNotes = (studentId: string, periodId: string | undefined, enabled = true) =>
  useQuery({
    queryKey: [...captureKeys.studentNotes(studentId), periodId ?? 'all'],
    enabled,
    queryFn: () =>
      api.get<NoteView[]>(`/students/${studentId}/notes${periodId ? `?periodId=${periodId}` : ''}`),
  });

export const useGroupNotes = (groupId: string, date: string) =>
  useQuery({
    queryKey: captureKeys.groupNotes(groupId, date),
    queryFn: () => api.get<NoteView[]>(`/groups/${groupId}/notes?date=${date}`),
  });

function useInvalidateNotes() {
  const queryClient = useQueryClient();
  return (note: Pick<NoteView, 'groupId' | 'student'>) =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: captureKeys.studentNotes(note.student.id) }),
      queryClient.invalidateQueries({ queryKey: ['groups', note.groupId, 'notes'] }),
    ]);
}

export const useCreateNote = () => {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ studentId, ...input }: CreateNoteInput & { studentId: string }) =>
      api.post<NoteView>(`/students/${studentId}/notes`, input),
    onSuccess: async (note) => {
      await invalidate(note);
      toast.success('Nota guardada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useUpdateNote = () => {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: ({ id, ...input }: UpdateNoteInput & { id: string }) =>
      api.patch<NoteView>(`/notes/${id}`, input),
    onSuccess: async (note) => {
      await invalidate(note);
      toast.success('Nota actualizada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

export const useDeleteNote = () => {
  const invalidate = useInvalidateNotes();
  return useMutation({
    mutationFn: (note: NoteView) => api.delete<void>(`/notes/${note.id}`),
    onSuccess: async (_data, note) => {
      await invalidate(note);
      toast.success('Nota borrada.');
    },
    onError: (error) => toast.error(errorMessage(error)),
  });
};

/** Downloads the printable capture sheet (with or without activity). */
export async function downloadCaptureSheet(
  groupId: string,
  activity?: { id: string; name: string },
) {
  try {
    const blob = await api.blob(
      `/groups/${groupId}/capture-sheet.pdf${activity ? `?activityId=${activity.id}` : ''}`,
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = activity ? `Hoja de captura - ${activity.name}.pdf` : 'Hoja de captura.pdf';
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
  } catch (error) {
    toast.error(errorMessage(error));
  }
}
