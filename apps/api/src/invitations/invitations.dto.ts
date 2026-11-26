import { createStaffInvitationSchema } from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';

export class CreateStaffInvitationDto extends createZodDto(createStaffInvitationSchema) {}
