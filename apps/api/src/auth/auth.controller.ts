import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  loginRequestSchema,
  registerRequestSchema,
  type AuthResponse,
  type LoginRequest,
  type RegisterRequest,
} from '@cece/contract';
import { ZodValidationPipe } from '../common/zod-validation.pipe';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** C1 — POST /v1/auth/register */
  @Post('register')
  @HttpCode(201)
  register(
    @Body(new ZodValidationPipe(registerRequestSchema)) dto: RegisterRequest,
  ): Promise<AuthResponse> {
    return this.auth.register(dto);
  }

  /** C2 — POST /v1/auth/login */
  @Post('login')
  @HttpCode(200)
  login(@Body(new ZodValidationPipe(loginRequestSchema)) dto: LoginRequest): Promise<AuthResponse> {
    return this.auth.login(dto);
  }
}
