import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Patch,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { Model, Types } from 'mongoose';
import { JwtAuthGuard } from '../../common/guards';
import { PUSH_SWITCHES, PushAudience, preferencesView } from './push-preferences';

@ApiTags('Push notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications/preferences')
export class PushPreferencesController {
  constructor(@InjectModel('User') private readonly userModel: Model<any>) {}

  private async ctx(req: any, audience?: string) {
    const id = req?.user?.id ?? req?.user?._id;
    if (!id) throw new ForbiddenException('Sign in to change notification settings.');
    const user: any = await this.userModel.findById(id).select('type push_preferences').lean();
    if (!user) throw new ForbiddenException('Sign in to change notification settings.');
    const side: PushAudience =
      audience === 'customer' || audience === 'vendor'
        ? audience
        : user.type === 'vendor'
          ? 'vendor'
          : 'customer';
    return { id: String(id), user, side };
  }

  @Get()
  @ApiOperation({ summary: 'Which push notifications this person gets, for one app' })
  @ApiQuery({ name: 'audience', required: false, enum: ['customer', 'vendor'], description: 'shop app: customer, vendor app: vendor' })
  async get(@Req() req: any, @Query('audience') audience?: string) {
    const { user, side } = await this.ctx(req, audience);
    return { data: { audience: side, switches: preferencesView(user.push_preferences, side) } };
  }

  @Patch()
  @ApiOperation({
    summary: 'Turn push switches on or off ({ "announcements": false }); locked switches stay on',
  })
  @ApiQuery({ name: 'audience', required: false, enum: ['customer', 'vendor'] })
  async update(
    @Req() req: any,
    @Body() body: Record<string, unknown>,
    @Query('audience') audience?: string,
  ) {
    const { id, side } = await this.ctx(req, audience);
    const switches = PUSH_SWITCHES[side];
    const set: Record<string, boolean> = {};
    for (const [key, value] of Object.entries(body ?? {})) {
      const sw = switches.find((s) => s.key === key);
      if (!sw) throw new BadRequestException(`Unknown notification setting "${key}".`);
      if (typeof value !== 'boolean') throw new BadRequestException(`"${key}" must be true or false.`);
      if (sw.locked && value === false) {
        throw new BadRequestException(`${sw.label} can't be turned off: they're about your orders, money or account.`);
      }
      if (!sw.locked) set[`push_preferences.${side}.${key}`] = value;
    }
    if (Object.keys(set).length) {
      await this.userModel.updateOne({ _id: new Types.ObjectId(id) }, { $set: set });
    }
    const user: any = await this.userModel.findById(id).select('push_preferences').lean();
    return {
      message: 'Notification settings saved.',
      data: { audience: side, switches: preferencesView(user?.push_preferences, side) },
    };
  }
}
