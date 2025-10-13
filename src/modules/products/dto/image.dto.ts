import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsUrl } from 'class-validator';

export class ImageDto {
  @ApiProperty({
    description: 'Public ID from Cloudinary or storage provider',
    example: 'qlozet/fabrics/royal-blue-001',
  })
  @IsString()
  @IsNotEmpty()
  public_id: string;

  @ApiProperty({
    description: 'Public accessible URL of the image',
    example:
      'https://res.cloudinary.com/qlozet/image/upload/v1/fabrics/royal-blue-001.jpg',
  })
  @IsUrl()
  @IsNotEmpty()
  url: string;
}
