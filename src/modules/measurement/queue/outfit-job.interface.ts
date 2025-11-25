import { GenerateOutfitRequestDto } from '../dto/generate-outfit.dto';

export interface GenerateOutfitJobData {
  type: 'generateOutfit';
  payload: GenerateOutfitRequestDto;
  webhook_url?: string;
}

export interface VideoPipelineJobData {
  type: 'videoPipeline';
  payload: any; // Replace with proper DTO if you have one
  files: { video: Express.Multer.File };
  business?: string;
  customer?: string;
  webhook_url?: string;
}

export interface AutoMaskJobData {
  type: 'autoMask';
  payload: any;
  files: {
    bg: Express.Multer.File;
    front: Express.Multer.File;
    side: Express.Multer.File;
  };
  business?: string;
  customer?: string;
  webhook_url?: string;
}

export interface AvatarJobData {
  type: 'avatar';
  payload: { ui_gender?: string };
  files: { predJson: Express.Multer.File };
  webhook_url?: string;
}

export type OutfitJobData =
  | GenerateOutfitJobData
  | VideoPipelineJobData
  | AutoMaskJobData
  | AvatarJobData;
