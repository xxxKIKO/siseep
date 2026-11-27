import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Put,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { LOGO_MAX_BYTES, type User } from '@siseep/shared';
import type { Response } from 'express';
import { Errors } from '../common/app.exception';
import { Authenticated, CurrentUser } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { FilesService } from '../files/files.service';
import { toPublicUser } from './user.schema';

/** The signed-in person's own files (teacher logo for the report cards). */
@ApiTags('me')
@ApiBearerAuth()
@Controller('me')
export class MeController {
  constructor(private readonly files: FilesService) {}

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
