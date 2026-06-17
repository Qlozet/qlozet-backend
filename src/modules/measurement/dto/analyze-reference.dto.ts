import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

export class AnalyzeReferenceDto {
  @ApiPropertyOptional({
    description:
      'Cloudinary URL of the reference image (provide this OR upload a file)',
    example: 'https://res.cloudinary.com/.../reference.jpg',
  })
  @IsOptional()
  @IsString()
  image_url?: string;

  @ApiPropertyOptional({
    description: 'AI provider to use for analysis',
    example: 'openai',
    default: 'openai',
  })
  @IsOptional()
  @IsString()
  provider?: string;

  @ApiPropertyOptional({
    description: 'AI model to use for analysis',
    example: 'gpt-5.5',
    default: 'gpt-5.5',
  })
  @IsOptional()
  @IsString()
  model?: string;
}

export interface AnalyzeReferenceResult {
  suggested_prompt: string;
  metadata: Record<string, any>;
  matched_styles: Record<
    string,
    {
      style_id: string;
      style_name: string;
      style_code: string;
      image_url?: string;
      matched_from: string;
    }
  >;
}
