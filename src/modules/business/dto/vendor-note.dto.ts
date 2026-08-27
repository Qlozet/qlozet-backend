import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { VendorNoteKind } from '../schemas/vendor-note.schema';

export class CreateVendorNoteDto {
  @ApiProperty({
    example: 'Called about the delayed payout; awaiting their bank details.',
    description: 'The note itself. For a flag, this is the reason.',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  body: string;

  @ApiPropertyOptional({
    enum: VendorNoteKind,
    default: VendorNoteKind.NOTE,
    description:
      "'flag' raises a concern against the vendor and marks them flagged in the vendors list; 'note' is an ordinary internal remark.",
  })
  @IsOptional()
  @IsEnum(VendorNoteKind)
  kind?: VendorNoteKind;
}

export class EscalateVendorDto {
  @ApiProperty({
    example: 'Repeated late fulfilment',
    description: "The ticket's issue type — its headline in the support queue.",
  })
  @IsString()
  @IsNotEmpty()
  issue_type: string;

  @ApiProperty({
    example: 'Three orders past their fulfilment deadline this month.',
  })
  @IsString()
  @IsNotEmpty()
  description: string;
}
