import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CustomerWaitlistDto {
  @ApiProperty({ example: 'John Doe', description: 'Full name of the customer' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'john@example.com', description: 'Email address of the customer' })
  @IsEmail()
  @IsNotEmpty()
  email: string;
}

export class VendorWaitlistDto {
  @ApiProperty({ example: 'Jane Smith', description: 'Full name of the vendor' })
  @IsString()
  @IsNotEmpty()
  fullName: string;

  @ApiProperty({ example: 'Jane Boutique', description: 'Name of the business' })
  @IsString()
  @IsNotEmpty()
  businessName: string;

  @ApiProperty({ example: 'jane@example.com', description: 'Business email address' })
  @IsEmail()
  @IsNotEmpty()
  businessEmail: string;

  @ApiProperty({ example: '+1234567890', description: 'Phone number' })
  @IsString()
  @IsNotEmpty()
  phoneNumber: string;

  @ApiProperty({ example: 'Clothing Brand', description: 'Type of the business' })
  @IsString()
  @IsNotEmpty()
  businessType: string;
}
