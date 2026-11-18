jest.mock('@gradio/client', () => ({ Client: {}, handle_file: jest.fn() }));
import { MeasurementService } from './measurement.service';
import { ScanFileStore } from './scan-file.store';
import { ScanUnreadableError } from './scan-result';

/**
 * The body scan sends two silhouettes the phone cut out; the backend holds
 * them in memory, hands them to the model and charges only for a scan that
 * found a body.
 */
const payload = (over: Record<string, number> = {}) => ({
  schema_version: 2,
  inputs: { height_cm: 178 },
  measurements: Object.entries({
    chest: 98, waist: 82, hip: 99, shoulder_breadth: 46, arm_length: 60, leg_length: 82, ...over,
  }).map(([name, value_cm]) => ({ name, value_cm, tier: 'predicted', mae_cm: 2 })),
});

const build = (spaceResult: unknown, balance = 100) => {
  const scanFiles = new ScanFileStore();
  const predict = jest.fn().mockResolvedValue({ data: [null, null, spaceResult] });
  const spend = jest.fn().mockResolvedValue(undefined);
  const svc: any = Object.create(MeasurementService.prototype);
  svc.scanFiles = scanFiles;
  svc.hbm = 'space';
  svc.logger = { log: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  svc.gradio = {
    getClient: jest.fn().mockResolvedValue({ predict }),
    bufferToBlob: (b: Buffer, type: string) => ({ b, type }),
  };
  svc.platformService = {
    getSettings: jest.fn().mockResolvedValue({ video_measurement_token_price: 30, image_measurement_token_price: 20 }),
  };
  svc.tokenService = { balance: jest.fn().mockResolvedValue(balance), spend };
  const job = {
    front_token: scanFiles.put(Buffer.from('front')),
    side_token: scanFiles.put(Buffer.from('side')),
    height_cm: 178,
    weight: 76,
    gender: 'male',
    kind: 'scan' as const,
    business: 'b1',
    customer: 'u1',
  };
  return { svc: svc as MeasurementService, predict, spend, job, scanFiles };
};

describe('silhouette scan', () => {
  it('measures from both silhouettes with the hybrid model and charges the scan price', async () => {
    const { svc, predict, spend, job, scanFiles } = build(payload());
    const r = await svc.silhouettePredict(job);
    expect(predict).toHaveBeenCalledWith('/run_predict', expect.objectContaining({
      model_choice: 'Hybrid (CNN+Tabular)',
      front_image: { b: Buffer.from('front'), type: 'image/png' },
      side_image: { b: Buffer.from('side'), type: 'image/png' },
      height_cm: 178,
      weight: 76,
      gender: 'male',
    }));
    expect(r.measurements.chest).toBe(98);
    expect(r.tailoring_meta.chest).toEqual({ tier: 'predicted', mae_cm: 2 });
    expect(spend).toHaveBeenCalledWith('video', 'b1', 'u1');
    scanFiles.onModuleDestroy();
  });

  it('charges the photo price for the photo capture', async () => {
    const { svc, spend, job, scanFiles } = build(payload());
    await svc.silhouettePredict({ ...job, kind: 'photo' });
    expect(spend).toHaveBeenCalledWith('image', 'b1', 'u1');
    scanFiles.onModuleDestroy();
  });

  it('charges nothing when no body was found', async () => {
    const { svc, spend, job, scanFiles } = build(payload({ hip: 0 }));
    await expect(svc.silhouettePredict(job)).rejects.toBeInstanceOf(ScanUnreadableError);
    expect(spend).not.toHaveBeenCalled();
    scanFiles.onModuleDestroy();
  });

  it('refuses a scan whose silhouettes are gone', async () => {
    const { svc, predict, job, scanFiles } = build(payload());
    scanFiles.release([job.front_token]);
    await expect(svc.silhouettePredict(job)).rejects.toThrow('expired');
    expect(predict).not.toHaveBeenCalled();
    scanFiles.onModuleDestroy();
  });

  it('refuses when the tokens ran out in the meantime', async () => {
    const { svc, predict, job, scanFiles } = build(payload(), 5);
    await expect(svc.silhouettePredict(job)).rejects.toThrow('Insufficient tokens');
    expect(predict).not.toHaveBeenCalled();
    scanFiles.onModuleDestroy();
  });
});
