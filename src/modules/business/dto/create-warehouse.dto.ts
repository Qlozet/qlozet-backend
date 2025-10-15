import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsNotEmpty, IsString } from 'class-validator';

export class CreateWarehouseDto {
  @ApiProperty({
    description: 'Name of the warehouse',
    example: 'Maiduguri Central Warehouse',
  })
  @IsString()
  @IsNotEmpty()
  name: string;

  @ApiProperty({
    description: 'Full address of the warehouse',
    example: 'Plot 12, Industrial Layout, Maiduguri, Borno State, Nigeria',
  })
  @IsString()
  @IsNotEmpty()
  address: string;

  @ApiProperty({
    description: 'Name of the warehouse contact person',
    example: 'Hassan Bello',
  })
  @IsString()
  @IsNotEmpty()
  contact_name: string;

  @ApiProperty({
    description: 'Phone number of the warehouse contact person',
    example: '+2348123456789',
  })
  @IsString()
  @IsNotEmpty()
  contact_phone: string;

  @ApiProperty({
    description: 'Email address of the warehouse contact person',
    example: 'hassan.bello@qoobea.com',
  })
  @IsEmail()
  contact_email: string;

  @ApiProperty({
    description: 'Current status of the warehouse',
    enum: ['active', 'inactive'],
    default: 'active',
    example: 'active',
  })
  @IsEnum(['active', 'inactive'])
  status: 'active' | 'inactive';
}
