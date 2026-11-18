import { scanResultUsable, toScanResult } from './scan-result';
import { SCAN_FILE_TTL_MS, ScanFileStore, isPng } from './scan-file.store';

describe('toScanResult', () => {
  it('reads the schema v2 payload: core and derived, with provenance', () => {
    const r = toScanResult({
      schema_version: 2,
      inputs: { height_cm: 180, gender: 'male' },
      measurements: [
        { name: 'chest', value_cm: 98.234, tier: 'predicted', mae_cm: 2.1, method: 'hybrid' },
        { name: 'arm-length', value_cm: 60.5, tier: 'predicted', mae_cm: 1.5 },
        { name: 'sleeve_length', value_cm: 62.1, tier: 'estimated', mae_cm: null },
        { name: 'waist', value_cm: 0, tier: 'predicted' },
      ],
      cm: { chest: 98.234, 'arm-length': 60.5 },
    });
    expect(r.measurements).toEqual({ chest: 98.23, arm_length: 60.5, sleeve_length: 62.1 });
    expect(r.tailoring_meta.chest).toEqual({ tier: 'predicted', mae_cm: 2.1, method: 'hybrid' });
    expect(r.tailoring_meta.sleeve_length).toEqual({ tier: 'estimated', mae_cm: null });
    expect(r.tailoring_meta.waist).toBeUndefined();
    expect(r.inputs).toEqual({ height_cm: 180, gender: 'male' });
  });

  it('reads the v1 file: the cm map plus derived rows', () => {
    const r = toScanResult({
      cm: { 'shoulder-breadth': 45.2, 'leg-length': 80 },
      derived: [{ name: 'neck', value_cm: 38.44, tier: 'estimated' }],
    });
    expect(r.measurements).toEqual({ shoulder_breadth: 45.2, leg_length: 80, neck: 38.4 });
  });

  it('falls back to the DataFrame labels', () => {
    const r = toScanResult({
      headers: ['Measurement', 'Value (cm)', 'Value (in)', 'Source'],
      data: [
        ['Bust circumference (chest at fullest point)', 92, 36.2, 'predicted'],
        ['Waist circumference (natural waist)', 74.5, 29.3, 'predicted'],
        ['Arm length (shoulder to wrist)', 57, 22.4, 'predicted'],
      ],
    });
    expect(r.measurements).toEqual({ chest: 92, waist: 74.5, arm_length: 57 });
  });

  it('gives an empty result for nothing', () => {
    expect(toScanResult(null)).toEqual({ measurements: {}, tailoring_meta: {} });
  });

  it('only calls a scan usable when every core measurement came back', () => {
    const full = { chest: 1, waist: 1, hip: 1, shoulder_breadth: 1, arm_length: 1, leg_length: 1 };
    expect(scanResultUsable({ measurements: full, tailoring_meta: {} })).toBe(true);
    expect(scanResultUsable({ measurements: { ...full, hip: 0 }, tailoring_meta: {} })).toBe(false);
  });
});

describe('ScanFileStore', () => {
  const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('x')]);

  it('hands a silhouette back by its key until released', () => {
    const store = new ScanFileStore();
    const t = store.put(png);
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(store.get(t)).toBe(png);
    store.release([t]);
    expect(store.get(t)).toBeNull();
    store.onModuleDestroy();
  });

  it('forgets a silhouette once it expires', () => {
    const store = new ScanFileStore();
    const now = 1_000_000;
    const t = store.put(png, now);
    expect(store.get(t, now + SCAN_FILE_TTL_MS - 1)).not.toBeNull();
    expect(store.get(t, now + SCAN_FILE_TTL_MS)).toBeNull();
    expect(store.size()).toBe(0);
    store.onModuleDestroy();
  });

  it('takes PNGs only', () => {
    expect(isPng(png)).toBe(true);
    expect(isPng(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5]))).toBe(false);
    expect(isPng(undefined)).toBe(false);
  });
});
