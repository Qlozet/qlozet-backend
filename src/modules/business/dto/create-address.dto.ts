import { ApiProperty } from '@nestjs/swagger';

export class CreateBusinessAddressDto {
  @ApiProperty({
    example: '24 Ahmadu Bello Way, Kaduna',
    description: 'Full street address of the business location',
  })
  address: string;

  @ApiProperty({
    example: 'Kaduna State',
    description: 'State where the business is located',
  })
  state: string;

  @ApiProperty({
    example: 'Kaduna',
    description: 'City where the business is located',
  })
  city: string;

  @ApiProperty({
    example: 'Nigeria',
    description: 'Country of the business location',
  })
  country: string;

  @ApiProperty({
    example: '800283',
    description: 'Postal or ZIP code of the business location',
  })
  zip_code: string;

  @ApiProperty({
    example: 10.5231,
    description: 'Latitude coordinate of the business address',
  })
  latitude: number;

  @ApiProperty({
    example: 7.4383,
    description: 'Longitude coordinate of the business address',
  })
  longitude: number;
}
