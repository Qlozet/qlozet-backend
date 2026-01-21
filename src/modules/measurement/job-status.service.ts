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

  async create(job_id: string, payload: any) {
    const job = new this.jobModel({
      job_id,
      payload,
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
      { job_id: jobId },
      { status, result, error },
      { new: true },
    );
  }

  async findByJobId(job_id: string) {
    return this.jobModel.findOne({ job_id });
  }
}
