import { Test } from '@nestjs/testing';

describe('AbsoluteMinimal', () => {
    it('should pass', () => {
        expect(true).toBe(true);
    });

    it('should see Test', () => {
        expect(Test).toBeDefined();
    });
});
