import {
  Controller,
  Post,
  Get,
  Put,
  Patch,
  Param,
  Body,
  Query,
  Req,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiTags,
  ApiOperation,
  ApiQuery,
  ApiParam,
} from '@nestjs/swagger';
import { JwtAuthGuard, RolesGuard } from 'src/common/guards';
import { Roles } from 'src/common/decorators/roles.decorator';
import { Public } from 'src/common/decorators/public.decorator';
import { UserType } from '../ums/schemas';

import { BespokeService } from './bespoke.service';
import { SuggestedVendorsService } from './suggested-vendors.service';
import { CreateDesignDto } from './dto/create-design.dto';
import { RequestQuotesDto } from './dto/request-quotes.dto';
import { SubmitQuoteDto } from './dto/submit-quote.dto';
import { SaveDraftDto } from './dto/save-draft.dto';
import { RevisionRequestDto } from './dto/revision-request.dto';

@Controller('bespoke')
@ApiTags('Bespoke')
@ApiBearerAuth('access-token')
@UseGuards(JwtAuthGuard, RolesGuard)
@UsePipes(new ValidationPipe({ transform: true }))
export class BespokeController {
  constructor(
    private readonly bespokeService: BespokeService,
    private readonly suggestedVendorsService: SuggestedVendorsService,
  ) {}

  // ════════════════════════════════════════════════════════════════
  //  TEMPLATES — public, browsable before sign-in
  // ════════════════════════════════════════════════════════════════

  @Public()
  @Get('templates')
  @ApiOperation({ summary: 'Active platform design templates' })
  async listTemplates() {
    return this.bespokeService.listTemplates();
  }

  @Public()
  @Post('templates/:id/use')
  @ApiOperation({
    summary: 'Open a template into the studio (returns it and counts the use)',
  })
  @ApiParam({ name: 'id', description: 'Template id' })
  async useTemplate(@Param('id') id: string) {
    return this.bespokeService.useTemplate(id);
  }

  // ════════════════════════════════════════════════════════════════
  //  CUSTOMER — Design Endpoints
  // ════════════════════════════════════════════════════════════════

  @Post('designs')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Save a bespoke design from the studio' })
  async createDesign(@Body() dto: CreateDesignDto, @Req() req: any) {
    return this.bespokeService.createDesign(dto, req.user);
  }

  @Put('designs/:id')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Update an existing bespoke design (draft or requesting quotes)' })
  @ApiParam({ name: 'id', description: 'Design ID' })
  async updateDesign(
    @Param('id') id: string,
    @Body() dto: CreateDesignDto,
    @Req() req: any,
  ) {
    return this.bespokeService.updateDesign(id, dto, req.user);
  }

  @Get('designs')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'List my bespoke designs' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getMyDesigns(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('status') status?: string,
  ) {
    return this.bespokeService.getMyDesigns(
      req.user.id,
      page || 1,
      size || 10,
      status,
    );
  }

  /**
   * Which tailors to offer for this design, best first.
   *
   * Design-scoped rather than a sort on the generic vendor list, because the
   * two strongest signals depend on the design: who supplies its fabric (and
   * so avoids the cross-vendor surcharge) and who makes that kind of garment.
   * The generic list knows neither, and returned vendors in no order at all —
   * effectively oldest first, which handed the work to whoever registered
   * earliest.
   */
  /**
   * The same ranking for a design that has not been saved yet.
   *
   * The studio saves a design when quotes are requested, not before, so on a
   * first request there is no id — which is the usual case. Takes the two
   * things the ranking needs directly.
   */
  @Get('suggested-vendors')
  @ApiOperation({
    summary: 'Ranked tailors for an unsaved design (category + fabric)',
  })
  async suggestedVendorsFor(
    @Query('category') category?: string,
    @Query('fabric_id') fabricId?: string,
    @Query('limit') limit?: string,
  ) {
    return this.suggestedVendorsService.forCriteria(
      { category, fabricId },
      Number(limit) || 8,
    );
  }

  @Get('designs/:id/suggested-vendors')
  @ApiOperation({
    summary: 'Ranked tailors to request quotes from, with the reason for each',
  })
  async suggestedVendors(
    @Param('id') id: string,
    @Query('limit') limit?: string,
  ) {
    return this.suggestedVendorsService.forDesign(id, Number(limit) || 8);
  }

  @Get('designs/:id')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Get a design with all its quotes' })
  @ApiParam({ name: 'id', description: 'Design ID' })
  async getDesignWithQuotes(@Param('id') id: string, @Req() req: any) {
    return this.bespokeService.getDesignWithQuotes(id, req.user.id);
  }

  @Post('designs/:id/request-quotes')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Send design to vendors for quoting (max 5)' })
  @ApiParam({ name: 'id', description: 'Design ID' })
  async requestQuotes(
    @Param('id') id: string,
    @Body() dto: RequestQuotesDto,
    @Req() req: any,
  ) {
    return this.bespokeService.requestQuotes(id, dto, req.user);
  }

  @Patch('designs/:id/cancel')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Cancel a bespoke design' })
  @ApiParam({ name: 'id', description: 'Design ID' })
  async cancelDesign(@Param('id') id: string, @Req() req: any) {
    return this.bespokeService.cancelDesign(id, req.user.id);
  }

  // ════════════════════════════════════════════════════════════════
  //  VENDOR — Quote Management
  // ════════════════════════════════════════════════════════════════

  @Get('quotes/vendor')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'List quote requests for this vendor' })
  @ApiQuery({ name: 'page', required: false, type: Number })
  @ApiQuery({ name: 'size', required: false, type: Number })
  @ApiQuery({ name: 'status', required: false, type: String })
  async getQuoteRequests(
    @Req() req: any,
    @Query('page') page?: number,
    @Query('size') size?: number,
    @Query('status') status?: string,
  ) {
    return this.bespokeService.getQuoteRequests(
      req.business.id,
      page || 1,
      size || 10,
      status,
    );
  }

  // Dual customer/vendor route. It MUST declare @Roles so the RolesGuard runs
  // and populates req.business for vendors — without it the guard short-circuits
  // (no roles = allow, set nothing), req.business is undefined, and a vendor
  // request wrongly falls to the customer branch below and 404s on its own
  // quote. That was the root cause of vendor quotes reading back as empty.
  @Get('quotes/:id')
  @Roles(UserType.VENDOR, UserType.CUSTOMER)
  @ApiOperation({ summary: 'Get quote detail (customer or vendor)' })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async getQuoteDetail(@Param('id') id: string, @Req() req: any) {
    // Vendor path
    if (req.business?.id) {
      return this.bespokeService.getQuoteDetail(id, req.business.id);
    }
    // Customer path — use a dedicated method or pass a marker
    return this.bespokeService.getQuoteDetailForCustomer(id, req.user.id);
  }

  @Patch('quotes/:id/draft')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Save quote as draft' })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async saveQuoteDraft(
    @Param('id') id: string,
    @Body() dto: SaveDraftDto,
    @Req() req: any,
  ) {
    return this.bespokeService.saveQuoteDraft(id, req.business.id, dto);
  }

  @Post('quotes/:id/submit')
  @Roles(UserType.VENDOR)
  @ApiOperation({ summary: 'Submit a completed quote' })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async submitQuote(
    @Param('id') id: string,
    @Body() dto: SubmitQuoteDto,
    @Req() req: any,
  ) {
    return this.bespokeService.submitQuote(id, req.business.id, dto);
  }

  // ════════════════════════════════════════════════════════════════
  //  CUSTOMER — Quote Actions
  // ════════════════════════════════════════════════════════════════

  @Post('quotes/:id/accept')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({
    summary:
      'Accept a quote → creates order + payment (wallet is instant, paystack redirects)',
  })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async acceptQuote(
    @Param('id') id: string,
    @Req() req: any,
    @Body()
    body: {
      payment_method?: 'wallet' | 'paystack';
      address_id?: string;
      measurement_set_name?: string;
    },
  ) {
    return this.bespokeService.acceptQuote(
      id,
      req.user,
      body?.payment_method === 'wallet' ? 'wallet' : 'paystack',
      body?.address_id,
      body?.measurement_set_name,
    );
  }

  @Post('quotes/:id/revision')
  @Roles(UserType.CUSTOMER)
  @ApiOperation({ summary: 'Request revision on a quote' })
  @ApiParam({ name: 'id', description: 'Quote ID' })
  async requestRevision(
    @Param('id') id: string,
    @Body() dto: RevisionRequestDto,
    @Req() req: any,
  ) {
    return this.bespokeService.requestRevision(id, req.user.id, dto);
  }
}
