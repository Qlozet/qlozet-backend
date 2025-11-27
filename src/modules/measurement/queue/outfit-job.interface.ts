import { AutoMaskSwaggerDto } from '../dto/auto-mask-predict.dto';
import { AvatarDto } from '../dto/avatar.dto';
import { EditGarmentDto } from '../dto/edit-image.dto';
import { GenerateOutfitRequestDto } from '../dto/generate-outfit.dto';
import { VideoPipelineSwaggerDto } from '../dto/video-pipeline.dto';

export interface GenerateOutfitJobData extends GenerateOutfitRequestDto {
  type: 'generateOutfit';
}

export interface VideoPipelineJobData extends VideoPipelineSwaggerDto {
  type: 'videoPipeline';
}

export interface AutoMaskJobData extends AutoMaskSwaggerDto {
  type: 'autoMask';
}

export interface AvatarJobData extends AvatarDto {
  type: 'avatar';
}
export interface EditGarmentJobData extends EditGarmentDto {
  type: 'editGarment';
}

export type OutfitJobData =
  | GenerateOutfitJobData
  | VideoPipelineJobData
  | AutoMaskJobData
  | AvatarJobData
  | EditGarmentJobData;
