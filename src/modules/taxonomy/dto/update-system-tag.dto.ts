import { PartialType } from '@nestjs/swagger';
import { CreateSystemTagDto } from './create-system-tag.dto';

export class UpdateSystemTagDto extends PartialType(CreateSystemTagDto) {}
