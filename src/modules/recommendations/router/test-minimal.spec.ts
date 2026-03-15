import { Test, TestingModule } from '@nestjs/testing';
import { RouterService } from './router.service';
import { ConfigService } from '@nestjs/config';

describe('MinimalRouterTest', () => {
    it('should pass', () => {
        expect(true).toBe(true);
    });

    it('should import RouterService', () => {
        expect(RouterService).toBeDefined();
    });
});
