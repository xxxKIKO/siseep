import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Patch,
  Post,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  LOGO_MAX_BYTES,
  updateProfileSchema,
  type User,
} from '@siseep/shared';
import { createZodDto } from 'nestjs-zod';
import type { Response } from 'express';
import { Errors } from '../common/app.exception';
import { AllowTemporaryPassword, Authenticated, CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { FilesService } from '../files/files.service';
import { ProfileService } from './profile.service';
import { toPublicUser } from './user.schema';

class UpdateProfileDto extends createZodDto(updateProfileSchema) {}
class ChangePasswordDto extends createZodDto(changePasswordSchema) {}

/** The signed-in person's own account: profile, password, photo and teacher logo. */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(
    private readonly files: FilesService,
    private readonly profile: ProfileService,
  ) {}

  @Authenticated()
  @Patch()
  @ApiOperation({ summary: 'Edita tu perfil: nombre, correo, teléfono y domicilio' })
  update(@Body() dto: UpdateProfileDto, @CurrentUser() user: RequestUser): Promise<User> {
    return this.profile.update(dto, user);
  }

  @Authenticated()
  @AllowTemporaryPassword()
  @Post('password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cambia tu contraseña (también la temporal del primer ingreso; padres: aviso de privacidad)',
  })
  changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: RequestUser): Promise<User> {
    return this.profile.changePassword(dto, user);
  }

  @Authenticated()
  @Put('photo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube tu foto de perfil (PNG o JPG, máximo 1 MB)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1 } }))
  setPhoto(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<User> {
    return this.profile.setPhoto(file, user);
  }

  @Authenticated()
  @Get('photo')
  @ApiOperation({ summary: 'Tu foto de perfil' })
  async getPhoto(@CurrentUser() user: RequestUser, @Res() res: Response): Promise<void> {
    const photo = await this.profile.photo(user);
    if (!photo) throw Errors.notFound('Aún no subes tu foto.');
    res.setHeader('Content-Type', photo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(photo.buffer);
  }

  @Authenticated()
  @Delete('photo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quita tu foto de perfil' })
  removePhoto(@CurrentUser() user: RequestUser): Promise<User> {
    return this.profile.removePhoto(user);
  }

  @Authenticated()
  @Put('logo')
  @ApiConsumes('multipart/form-data')
  @ApiOperation({ summary: 'Sube tu logo para las boletas (PNG o JPG, máximo 1 MB)' })
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: LOGO_MAX_BYTES + 1, files: 1 } }))
  async setLogo(
    @UploadedFile() file: Express.Multer.File | undefined,
    @CurrentUser() user: RequestUser,
  ): Promise<User> {
    const fileId = await this.files.storeLogo(file, { userId: user.doc._id, kind: 'teacher-logo' });
    const previous = user.doc.logoFileId;
    user.doc.logoFileId = fileId;
    await user.doc.save();
    await this.files.remove(previous);
    return toPublicUser(user.doc);
  }

  @Authenticated()
  @Get('logo')
  @ApiOperation({ summary: 'Tu logo para las boletas' })
  async getLogo(@CurrentUser() user: RequestUser, @Res() res: Response): Promise<void> {
    const logo = await this.files.read(user.doc.logoFileId);
    if (!logo) throw Errors.notFound('Aún no subes tu logo.');
    res.setHeader('Content-Type', logo.contentType);
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.send(logo.buffer);
  }

  @Authenticated()
  @Delete('logo')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Quita tu logo de las boletas' })
  async removeLogo(@CurrentUser() user: RequestUser): Promise<User> {
    const previous = user.doc.logoFileId;
    user.doc.logoFileId = null;
    await user.doc.save();
    await this.files.remove(previous);
    return toPublicUser(user.doc);
  }
}
