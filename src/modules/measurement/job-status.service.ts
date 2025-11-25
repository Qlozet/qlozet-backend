import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  JobStatus,
  JobStatusDocument,
  JobState,
} from '../../common/schemas/job-status.schema';

@Injectable()
export class JobStatusService {
  constructor(
    @InjectModel(JobStatus.name) private jobModel: Model<JobStatusDocument>,
  ) {}

  async create(jobId: string, payload: any, webhookUrl?: string) {
    const job = new this.jobModel({
      jobId,
      payload,
      webhookUrl,
      status: JobState.QUEUED,
    });
    return job.save();
  }

  async updateStatus(
    jobId: string,
    status: JobState,
    result?: any,
    error?: string,
  ) {
    return this.jobModel.findOneAndUpdate(
      { jobId },
      { status, result, error },
      { new: true },
    );
  }

  async findByJobId(jobId: string) {
    return this.jobModel.findOne({ jobId });
  }
}
