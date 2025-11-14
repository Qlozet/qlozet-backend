import { Injectable, Logger } from '@nestjs/common';
import { BusinessService } from 'src/modules/business/business.service';

@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(private readonly businessService: BusinessService) {}
}
