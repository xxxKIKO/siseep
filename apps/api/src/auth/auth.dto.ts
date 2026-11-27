import {
  acceptInviteSchema,
  forgotPasswordSchema,
  guardianCodePreviewSchema,
  registerGuardianSchema,
  loginSchema,
  resetPasswordSchema,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';

export class LoginDto extends createZodDto(loginSchema) {}
export class ForgotPasswordDto extends createZodDto(forgotPasswordSchema) {}
export class ResetPasswordDto extends createZodDto(resetPasswordSchema) {}
export class AcceptInviteDto extends createZodDto(acceptInviteSchema) {}
export class GuardianCodePreviewDto extends createZodDto(guardianCodePreviewSchema) {}
export class RegisterGuardianDto extends createZodDto(registerGuardianSchema) {}
