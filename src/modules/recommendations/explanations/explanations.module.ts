import { Module } from '@nestjs/common';
import { ExplanationsService } from './explanations.service';
import { EventsModule } from '../events/events.module';

@Module({
    imports: [EventsModule],
    providers: [ExplanationsService],
    exports: [ExplanationsService],
})
export class ExplanationsModule { }
