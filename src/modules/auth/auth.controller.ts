import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
  ApiBody,
  ApiBearerAuth,
} from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { VendorRegisterDto, CustomerRegistrationDto } from './dto';
import { RegisterResponseDto } from './dto/register-response.dto';
import { LoginDto } from './dto/login.dto';
import { Public } from '../../common/decorators/public.decorator';
import { ChangePasswordDto } from './dto/change-password.dto';
import { PasswordResetRequestDto } from './dto/password-reset-request.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { ResendVerificationDto } from './dto/resend-verification.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@ApiTags('Auth')
@Controller('auth')
// @UsePipes(
//   new ValidationPipe({
//     whitelist: true,
//     forbidNonWhitelisted: true,
//     transform: true,
//   }),
// )
export class AuthController {
  constructor(private readonly authService: AuthService) {}
  @Post('register/vendor')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new vendor',
    description:
      'Creates a new vendor account with business and personal information.',
  })
  @ApiBody({
    type: VendorRegisterDto,
    description: 'Vendor registration data',
    examples: {
      sample: {
        summary: 'Sample vendor registration',
        value: {
          businessName: 'Fashion Store Ltd',
          businessEmail: 'business@fashionstore.com',
          businessPhoneNumber: '+2348012345678',
          businessAddress: '123 Fashion Street, Lagos Island, Lagos',
          personalName: 'John Doe',
          personalEmail: 'kendo@fashionstore.com',
          personalPhoneNumber: '+2348012345679',
          nationalIdentityNumber: '12345678901',
          password: 'SecurePassword123',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Vendor registered successfully.',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid data provided.',
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone number already registered.',
  })
  async registerVendor(@Body() vendorRegisterDto: VendorRegisterDto) {
    return this.authService.registerVendor(vendorRegisterDto);
  }

  // Customer Registration
  @Post('register/customer')
  @Public()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Register a new customer',
    description: 'Creates a new customer account with personal information.',
  })
  @ApiBody({
    type: CustomerRegistrationDto,
    description: 'Customer registration data',
    examples: {
      sample: {
        summary: 'Sample customer registration',
        value: {
          fullName: 'John Doe',
          firstName: 'John',
          lastName: 'Doe',
          phoneNumber: '+2348012345678',
          email: 'john.doe@example.com',
          password: 'SecurePassword123',
        },
      },
    },
  })
  @ApiResponse({
    status: 201,
    description: 'Customer registered successfully.',
    type: RegisterResponseDto,
  })
  @ApiResponse({
    status: 400,
    description: 'Validation error or invalid data provided.',
  })
  @ApiResponse({
    status: 409,
    description: 'Email or phone number already registered.',
  })
  async registerCustomer(@Body() customerRegisterDto: CustomerRegistrationDto) {
    return this.authService.registerCustomer(customerRegisterDto);
  }

  // Vendor Login
  @Post('login/vendor')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Vendor login',
    description: 'Authenticate vendor and return access token.',
  })
  @ApiBody({
    description: 'Vendor login credentials.',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'business@fashionstore.com' },
        password: { type: 'string', example: 'SecurePassword123' },
      },
      required: ['email', 'password'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Access token returned.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials.',
  })
  async loginVendor(@Body() loginDto: LoginDto) {
    return this.authService.loginVendor(loginDto.email, loginDto.password);
  }

  @Post('login/customer')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Customer login',
    description: 'Authenticate customer and return access token.',
  })
  @ApiBody({
    description: 'Customer login credentials.',
    schema: {
      type: 'object',
      properties: {
        email: { type: 'string', example: 'customer@example.com' },
        password: { type: 'string', example: 'SecurePassword123' },
      },
      required: ['email', 'password'],
    },
  })
  @ApiResponse({
    status: 200,
    description: 'Login successful. Access token returned.',
  })
  @ApiResponse({
    status: 401,
    description: 'Invalid credentials.',
  })
  @ApiResponse({
    status: 404,
    description: 'Customer not found.',
  })
  async loginCustomer(@Body() loginDto: LoginDto) {
    return this.authService.loginCustomer(loginDto.email, loginDto.password);
  }
  // ✅ Verify Email
  @Post('verify-email')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Verify user email',
    description: 'Verify email using a token sent to user email address.',
  })
  @ApiBody({
    type: VerifyEmailDto,
    description: 'Email verification token',
  })
  async verifyEmail(@Body() verifyEmailDto: VerifyEmailDto) {
    return this.authService.verifyEmail(verifyEmailDto.token);
  }

  // ✅ Resend Verification Email
  @Post('resend-verification')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resend verification email',
    description: 'Resends verification link to user email address.',
  })
  @ApiBody({
    type: ResendVerificationDto,
  })
  async resendVerificationEmail(
    @Body() resendVerificationDto: ResendVerificationDto,
  ) {
    return this.authService.resendVerificationEmail(
      resendVerificationDto.email,
    );
  }

  // ✅ Request Password Reset
  @Post('forgot-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Request password reset',
    description:
      'Sends a password reset link to the user email if the account exists.',
  })
  @ApiBody({
    type: PasswordResetRequestDto,
  })
  async requestPasswordReset(
    @Body() passwordResetRequestDto: PasswordResetRequestDto,
  ) {
    return this.authService.requestPasswordReset(passwordResetRequestDto.email);
  }

  // ✅ Reset Password
  @Post('reset-password')
  @Public()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reset password using token',
    description:
      'Reset password after receiving a valid reset token via email.',
  })
  @ApiBody({
    type: PasswordResetDto,
  })
  async resetPassword(@Body() passwordResetDto: PasswordResetDto) {
    const { token, newPassword } = passwordResetDto;
    return this.authService.resetPassword(token, newPassword);
  }

  // ✅ Change Password (Authenticated)
  @Post('change-password')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Change current password',
    description: 'Change user password after authentication.',
  })
  @ApiBody({
    type: ChangePasswordDto,
  })
  async changePassword(@Body() changePasswordDto: ChangePasswordDto) {
    const { userId, currentPassword, newPassword } = changePasswordDto;
    return this.authService.changePassword(
      userId,
      currentPassword,
      newPassword,
    );
  }
  @Public()
  @Post('refresh')
  async refresh(@Body() dto: RefreshTokenDto) {
    const tokens = await this.authService.refreshTokens(
      dto.userId,
      dto.refreshToken,
    ); //
    return { message: 'Token refreshed successfully', data: tokens };
  }
}
