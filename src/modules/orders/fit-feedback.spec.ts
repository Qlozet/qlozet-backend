import { cleanFitIssues, isMadeToFit, problemsFor } from './fit-feedback';

describe('fit feedback issues', () => {
  it('round areas are tight or loose; lengths are long or short', () => {
    expect(problemsFor('chest')).toEqual(['tight', 'loose']);
    expect(problemsFor('sleeve_length')).toEqual(['long', 'short']);
    expect(problemsFor('elbow')).toEqual([]);
  });

  it('keeps one answer per area and rejects nonsense', () => {
    expect(
      cleanFitIssues([
        { area: 'chest', problem: 'tight' },
        { area: 'sleeve_length', problem: 'long' },
        { area: 'chest', problem: 'loose' },
      ]),
    ).toEqual([
      { area: 'chest', problem: 'loose' },
      { area: 'sleeve_length', problem: 'long' },
    ]);
    expect(cleanFitIssues(undefined)).toEqual([]);
    expect(() => cleanFitIssues([{ area: 'chest', problem: 'long' }])).toThrow(/tight or loose/);
    expect(() => cleanFitIssues([{ area: 'elbow', problem: 'tight' }])).toThrow(/Unknown/);
    expect(() => cleanFitIssues('chest')).toThrow(/list/);
  });

  it('applies to bespoke orders and orders with a custom line', () => {
    expect(isMadeToFit({ type: 'bespoke', items: [] })).toBe(true);
    expect(isMadeToFit({ type: 'standard', items: [{ clothing_type: 'customize' }] })).toBe(true);
    expect(isMadeToFit({ type: 'standard', items: [{ clothing_type: 'ready_to_wear' }] })).toBe(false);
  });
});
