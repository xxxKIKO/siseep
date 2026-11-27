import type {
  ChangePasswordInput,
  CreatedAccountView,
  CreateStaffInput,
  TemporaryPasswordView,
  UpdateProfileInput,
  User,
} from '@siseep/shared';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api, errorMessage } from '@/lib/api-client';

export const myPhotoKey = ['me', 'photo'] as const;

/** Own profile photo as an object URL (only when the account has one). */
export const useMyPhoto = (hasPhoto: boolean) =>
  useQuery({
    queryKey: myPhotoKey,
    enabled: hasPhoto,
    queryFn: async () => URL.createObjectURL(await api.blob('/me/photo')),
    staleTime: Infinity,
    retry: false,
  });

export const updateProfile = (input: UpdateProfileInput) => api.patch<User>('/me', input);
export const changePassword = (input: ChangePasswordInput) => api.post<User>('/me/password', input);

export function uploadPhoto(file: File): Promise<User> {
  const form = new FormData();
  form.append('file', file);
  return api.upload<User>('/me/photo', form, 'PUT');
}
export const removePhoto = () => api.delete<User>('/me/photo');

/** New staff account (username + temporary password, shown once). */
export function useCreateStaff() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (input: CreateStaffInput) => api.post<CreatedAccountView>('/users', input),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['users'] }),
  });
}

export function useResetUserPassword() {
  return useMutation({
    mutationFn: (userId: string) =>
      api.post<TemporaryPasswordView>(`/users/${userId}/reset-password`),
    onError: (error) => toast.error(errorMessage(error)),
  });
}
