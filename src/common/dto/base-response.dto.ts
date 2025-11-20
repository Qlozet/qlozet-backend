// common/dto/base-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';

export class BaseResponseDto {
  @ApiProperty({ example: 200 })
  statusCode: number;

  @ApiProperty({ example: 'Request successful' })
  message: string;

  @ApiProperty({ example: null })
  error: any;

  @ApiProperty({ example: 1763635865070 })
  timestamp: number;

  @ApiProperty({ example: 'v1' })
  version: string;

  @ApiProperty({ example: '/api/auth/login/vendor' })
  path: string;

  @ApiProperty()
  data: any;
}
