import { Controller, Get, UseGuards } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Model } from 'mongoose';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { UserType } from '../../ums/schemas';
import {
  MeasurementCorrection,
  MeasurementCorrectionDocument,
} from './measurement-correction.schema';
import {
  ACCURACY_PIPELINE,
  AccuracyRow,
  MIN_SAMPLES_TO_CALIBRATE,
  summariseAccuracy,
} from './measurement-corrections';
import { Order, OrderDocument } from '../../orders/schemas/orders.schema';

/**
 * What the measurement system has learned so far, for the admin console:
 * how far off each body part runs (from the correction log) and where
 * delivered made-to-fit pieces were off (from fit feedback). Read-only;
 * nothing is corrected automatically yet.
 */
@Controller('admin/measurements')
@ApiTags('Admin - Measurements')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
export class MeasurementAccuracyController {
  constructor(
    @InjectModel(MeasurementCorrection.name)
    private readonly corrections: Model<MeasurementCorrectionDocument>,
    @InjectModel(Order.name)
    private readonly orders: Model<OrderDocument>,
  ) {}

  @Roles(UserType.PLATFORM)
  @Get('accuracy')
  @ApiOperation({ summary: 'Measurement accuracy: corrections per body part and fit feedback' })
  async accuracy() {
    const [rows, totals, sources, fit] = await Promise.all([
      this.corrections.aggregate<AccuracyRow>(ACCURACY_PIPELINE as any[]),
      this.corrections.aggregate([
        { $group: { _id: null, total: { $sum: 1 }, outliers: { $sum: { $cond: ['$outlier', 1, 0] } } } },
      ]),
      this.corrections.aggregate([{ $group: { _id: '$source', count: { $sum: 1 } } }]),
      this.orders.aggregate([
        { $match: { fit_feedback: { $ne: null } } },
        {
          $facet: {
            outcomes: [{ $group: { _id: '$fit_feedback.fit', count: { $sum: 1 } } }],
            issues: [
              { $unwind: '$fit_feedback.issues' },
              {
                $group: {
                  _id: {
                    area: '$fit_feedback.issues.area',
                    problem: '$fit_feedback.issues.problem',
                    garment: { $ifNull: ['$fit_feedback.garment', null] },
                  },
                  count: { $sum: 1 },
                },
              },
              { $sort: { count: -1 } },
              { $limit: 50 },
            ],
          },
        },
      ]),
    ]);
    const facet = fit?.[0] ?? { outcomes: [], issues: [] };
    return {
      data: {
        min_samples_to_calibrate: MIN_SAMPLES_TO_CALIBRATE,
        corrections: {
          total: totals?.[0]?.total ?? 0,
          left_out_as_slips: totals?.[0]?.outliers ?? 0,
          by_source: Object.fromEntries(sources.map((s: any) => [s._id, s.count])),
          parts: summariseAccuracy(rows),
        },
        fit: {
          outcomes: Object.fromEntries(facet.outcomes.map((o: any) => [o._id, o.count])),
          issues: facet.issues.map((i: any) => ({ ...i._id, count: i.count })),
        },
      },
    };
  }
}
