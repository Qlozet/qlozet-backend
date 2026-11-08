import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Post,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import { ApiBearerAuth, ApiQuery, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, IsArray, IsOptional, IsString } from 'class-validator';
import { JwtAuthGuard, RolesGuard } from '../../../common/guards';
import { Roles } from '../../../common/decorators/roles.decorator';
import { UserType } from '../../ums/schemas';
import { OnboardingService } from './onboarding.service';
import { normalizeGender } from './onboarding-picks';

export class SaveOnboardingPicksDto {
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  product_ids?: string[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(60)
  @IsString({ each: true })
  style_ids?: string[];
}

const genderOf = (value: unknown) => {
  const g = normalizeGender(value);
  if (!g) throw new BadRequestException('gender must be male or female');
  return g;
};

const listOf = (value?: string) =>
  String(value ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, 60);

/** The style steps at sign-up, and "Update my style" from the profile. */
@ApiTags('Onboarding')
@Controller('recommends/onboarding')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class OnboardingController {
  constructor(private readonly onboarding: OnboardingService) {}

  @Roles(UserType.CUSTOMER)
  @Get('looks')
  @ApiQuery({ name: 'gender', enum: ['male', 'female'] })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, description: 'Search looks by name or category' })
  looks(@Query('gender') gender: string, @Query('limit') limit?: string, @Query('q') q?: string) {
    return this.onboarding.getLooks(genderOf(gender), limit ? Number(limit) : undefined, q);
  }

  @Roles(UserType.CUSTOMER)
  @Get('looks/similar')
  @ApiQuery({ name: 'kind', enum: ['product', 'style'] })
  @ApiQuery({ name: 'id' })
  @ApiQuery({ name: 'gender', enum: ['male', 'female'] })
  @ApiQuery({ name: 'exclude', required: false, description: 'Comma-separated look ids already on screen' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  similar(
    @Query('kind') kind: string,
    @Query('id') id: string,
    @Query('gender') gender: string,
    @Query('exclude') exclude?: string,
    @Query('limit') limit?: string,
  ) {
    if (kind !== 'product' && kind !== 'style') throw new BadRequestException('kind must be product or style');
    if (!id) throw new BadRequestException('id is required');
    return this.onboarding.getSimilar({
      kind,
      id,
      gender: genderOf(gender),
      exclude: listOf(exclude),
      limit: limit ? Number(limit) : undefined,
    });
  }

  @Roles(UserType.CUSTOMER)
  @Get('designers')
  @ApiQuery({ name: 'gender', enum: ['male', 'female'] })
  @ApiQuery({ name: 'picked', required: false, description: 'Comma-separated product ids picked on the looks step' })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiQuery({ name: 'q', required: false, description: 'Search designers by store name' })
  designers(
    @Req() req: any,
    @Query('gender') gender: string,
    @Query('picked') picked?: string,
    @Query('limit') limit?: string,
    @Query('q') q?: string,
  ) {
    return this.onboarding.getDesigners(
      req.user.id,
      genderOf(gender),
      listOf(picked),
      limit ? Number(limit) : undefined,
      q,
    );
  }

  @Roles(UserType.CUSTOMER)
  @Post('picks')
  savePicks(@Req() req: any, @Body() dto: SaveOnboardingPicksDto) {
    return this.onboarding.savePicks(req.user.id, dto.product_ids ?? [], dto.style_ids ?? []);
  }
}
