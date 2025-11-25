import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type JobStatusDocument = JobStatus & Document;

export enum JobState {
  QUEUED = 'queued',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

@Schema({ timestamps: true })
export class JobStatus {
  @Prop({ required: true })
  jobId: string;

  @Prop({ type: Object, default: {} })
  payload: any;

  @Prop({ enum: JobState, default: JobState.QUEUED })
  status: JobState;

  @Prop({ type: Object })
  result?: any;

  @Prop({ type: String })
  webhook_url?: string;

  @Prop({ type: String })
  error?: string;
}

export const JobStatusSchema = SchemaFactory.createForClass(JobStatus);
