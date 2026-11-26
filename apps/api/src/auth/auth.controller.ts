import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { AuthResponse, User } from '@siseep/shared';
import type { CookieOptions, Request, Response } from 'express';
import { CurrentUser, Public } from '../common/decorators';
import type { RequestUser } from '../common/request-user';
import { AppConfigService } from '../config/app-config.service';
import { AcceptInviteDto, ForgotPasswordDto, LoginDto, ResetPasswordDto } from './auth.dto';
import { AuthService } from './auth.service';
import { LoginThrottlerGuard } from './login-throttler.guard';
import type { ClientMeta } from './sessions.service';

export const REFRESH_COOKIE = 'siseep_rt';
/** The refresh cookie is only sent to the auth endpoints. */
export const REFRESH_COOKIE_PATH = '/api/v1/auth';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly config: AppConfigService,
  ) {}

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('login')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Inicia sesión con correo y contraseña' })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.login(dto, clientMeta(req));
    this.setRefreshCookie(res, result.refreshToken);
    return result.body;
  }

  @Public()
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Renueva el access token con la cookie de refresh (y la rota)' })
  async refresh(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    try {
      const result = await this.auth.refresh(readRefreshCookie(req), clientMeta(req));
      this.setRefreshCookie(res, result.refreshToken);
      return result.body;
    } catch (error) {
      this.clearRefreshCookie(res);
      throw error;
    }
  }

  @Public()
  @Post('logout')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cierra la sesión de este dispositivo' })
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response): Promise<void> {
    await this.auth.logout(readRefreshCookie(req));
    this.clearRefreshCookie(res);
  }

  @Post('logout-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Cierra la sesión en todos los dispositivos' })
  async logoutAll(
    @CurrentUser() user: RequestUser,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    await this.auth.logoutAll(user);
    this.clearRefreshCookie(res);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Datos del usuario con sesión iniciada' })
  me(@CurrentUser() user: RequestUser): User {
    return this.auth.me(user);
  }

  @Public()
  @Post('accept-invite')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Crea la cuenta del personal a partir de una invitación' })
  async acceptInvite(
    @Body() dto: AcceptInviteDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<AuthResponse> {
    const result = await this.auth.acceptInvite(dto, clientMeta(req));
    this.setRefreshCookie(res, result.refreshToken);
    return result.body;
  }

  @Public()
  @UseGuards(LoginThrottlerGuard)
  @Post('forgot')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Envía un enlace para restablecer la contraseña' })
  forgot(@Body() dto: ForgotPasswordDto): Promise<void> {
    return this.auth.forgotPassword(dto.email);
  }

  @Public()
  @Post('reset')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Cambia la contraseña con el enlace recibido por correo' })
  reset(@Body() dto: ResetPasswordDto): Promise<void> {
    return this.auth.resetPassword(dto);
  }

  private cookieOptions(): CookieOptions {
    return {
      httpOnly: true,
      secure: this.config.get('COOKIE_SECURE'),
      sameSite: 'strict',
      path: REFRESH_COOKIE_PATH,
    };
  }

  private setRefreshCookie(res: Response, token: string): void {
    res.cookie(REFRESH_COOKIE, token, {
      ...this.cookieOptions(),
      maxAge: this.config.get('REFRESH_TOKEN_TTL_DAYS') * 24 * 60 * 60 * 1000,
    });
  }

  private clearRefreshCookie(res: Response): void {
    res.clearCookie(REFRESH_COOKIE, this.cookieOptions());
  }
}

function readRefreshCookie(req: Request): string | undefined {
  const value = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  return typeof value === 'string' ? value : undefined;
}

function clientMeta(req: Request): ClientMeta {
  return {
    ip: req.ip ?? '',
    userAgent: (req.headers['user-agent'] ?? '').slice(0, 300),
  };
}
