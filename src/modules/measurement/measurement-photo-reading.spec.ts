import {
  inferUnit,
  parsePhotoReading,
  photoReadingRequest,
  plausibleCm,
} from './measurement-photo-reading';
import { MeasurementPhotoService } from './measurement-photo.service';

const reply = (body: any, stop_reason = 'end_turn') => ({
  stop_reason,
  content: [{ type: 'text', text: JSON.stringify(body) }],
});

describe('reading a measurement book photo', () => {
  it('turns inches into cm and keeps what was written', () => {
    const r = parsePhotoReading(
      reply({
        is_measurements: true,
        note: '',
        people: [
          {
            label: 'Chidi',
            unit: 'inch',
            values: [
              { field: 'chest', value: 40, written_as: 'Ch 40', clear: true },
              {
                field: 'shoulder_width',
                value: 18.5,
                written_as: 'Sh 18½',
                clear: true,
              },
              {
                field: 'sleeve_length',
                value: 25,
                written_as: 'Sl 25',
                clear: false,
              },
            ],
            unmatched: ['TL 30'],
          },
        ],
      }),
    )!;
    const p = r.people[0];
    expect(r.is_measurements).toBe(true);
    expect(p.label).toBe('Chidi');
    expect(p.values.chest).toEqual({
      value_cm: 101.6,
      written_as: 'Ch 40',
      clear: true,
    });
    expect(p.values.shoulder_width?.value_cm).toBe(47);
    expect(p.values.sleeve_length?.clear).toBe(false);
    expect(p.unmatched).toEqual(['TL 30']);
    expect(p.unit_guessed).toBe(false);
  });

  it('works out the unit when the page does not say', () => {
    expect(
      inferUnit([
        { field: 'chest', value: 38 },
        { field: 'waist', value: 32 },
      ]),
    ).toBe('inch');
    expect(
      inferUnit([
        { field: 'chest', value: 98 },
        { field: 'waist', value: 84 },
      ]),
    ).toBe('cm');
    const r = parsePhotoReading(
      reply({
        is_measurements: true,
        note: '',
        people: [
          {
            label: '',
            unit: 'unknown',
            values: [
              { field: 'waist', value: 34, written_as: 'W 34', clear: true },
            ],
            unmatched: [],
          },
        ],
      }),
    )!;
    expect(r.people[0].label).toBe('Person 1');
    expect(r.people[0].unit_guessed).toBe(true);
    expect(r.people[0].values.waist?.value_cm).toBe(86.4);
  });

  it('flags numbers no body has, instead of dropping them', () => {
    expect(plausibleCm('chest', 2000)).toBe(false);
    expect(plausibleCm('height', 170)).toBe(true);
    const r = parsePhotoReading(
      reply({
        is_measurements: true,
        note: '',
        people: [
          {
            label: 'A',
            unit: 'inch',
            values: [
              { field: 'chest', value: 380, written_as: 'Ch 380', clear: true },
            ],
            unmatched: [],
          },
        ],
      }),
    )!;
    expect(r.people[0].values.chest?.clear).toBe(false);
  });

  it('ignores unknown fields and repeats; keeps several people apart', () => {
    const r = parsePhotoReading(
      reply({
        is_measurements: true,
        note: '',
        people: [
          {
            label: 'Mum',
            unit: 'inch',
            values: [
              { field: 'chest', value: 42, written_as: 'B 42', clear: true },
              { field: 'chest', value: 44, written_as: 'B 44', clear: true },
              { field: 'tail', value: 3, written_as: 'x', clear: true },
            ],
            unmatched: [],
          },
          {
            label: 'Dad',
            unit: 'inch',
            values: [
              { field: 'neck', value: 16, written_as: 'N 16', clear: true },
            ],
            unmatched: [],
          },
        ],
      }),
    )!;
    expect(r.people.map((p) => p.label)).toEqual(['Mum', 'Dad']);
    expect(Object.keys(r.people[0].values)).toEqual(['chest']);
    expect(r.people[0].values.chest?.value_cm).toBe(106.7);
  });

  it('no measurements, a refusal or a cut-off reply', () => {
    expect(
      parsePhotoReading(
        reply({ is_measurements: false, note: '', people: [] }),
      )!.is_measurements,
    ).toBe(false);
    expect(parsePhotoReading(reply({}, 'refusal'))).toBeNull();
    expect(parsePhotoReading(reply({}, 'max_tokens'))).toBeNull();
    expect(
      parsePhotoReading({ content: [{ type: 'text', text: 'nope' }] }),
    ).toBeNull();
  });

  it('sends a photo as an image and a PDF as a document', () => {
    const img = photoReadingRequest(
      { kind: 'image', mediaType: 'image/png', base64: 'AAA' },
      'm',
    );
    expect((img.messages[0].content[0] as any).type).toBe('image');
    const pdf = photoReadingRequest({ kind: 'pdf', base64: 'AAA' }, 'm');
    expect((pdf.messages[0].content[0] as any).type).toBe('document');
    expect(img.output_config.format.type).toBe('json_schema');
  });

  it('accepts photos and PDFs only, under 10 MB', () => {
    const buf = Buffer.from('x');
    expect(
      MeasurementPhotoService.media({ buffer: buf, mimetype: 'image/jpeg' })
        .kind,
    ).toBe('image');
    expect(
      MeasurementPhotoService.media({
        buffer: buf,
        mimetype: 'application/pdf',
      }).kind,
    ).toBe('pdf');
    expect(() =>
      MeasurementPhotoService.media({ buffer: buf, mimetype: 'text/plain' }),
    ).toThrow(/photo/);
    expect(() =>
      MeasurementPhotoService.media({
        buffer: buf,
        mimetype: 'image/png',
        size: 11 * 1024 * 1024,
      }),
    ).toThrow(/10 MB/);
    expect(() => MeasurementPhotoService.media(undefined)).toThrow(
      /Add a photo/,
    );
  });
});
