import { Module } from '@nestjs/common';
import { MeasurementService } from './measurement.service';
import { MeasurementController } from './measurement.controller';
import { GradioService } from './gradio.service';
import { CloudinaryService } from '../cloudinary/cloudinary.service';
import { JwtService } from '@nestjs/jwt';
import { MongooseModule } from '@nestjs/mongoose';
import { User } from '../ums/schemas';
import { UserSchema } from '../ums/schemas/user.schema';
import { Role, RoleSchema } from '../ums/schemas/role.schema';

@Module({
  imports: [
    MongooseModule.forFeature([
      { name: User.name, schema: UserSchema },
      { name: Role.name, schema: RoleSchema },
    ]),
  ],
  controllers: [MeasurementController],
  providers: [MeasurementService, GradioService, CloudinaryService, JwtService],
})
export class MeasurementModule {}
