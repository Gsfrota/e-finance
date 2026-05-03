import { describe, expect, it } from 'vitest';
import { isValidHHMM } from '../src/actions/bot-config-actions';

describe('isValidHHMM', () => {
  it.each([
    ['00:00', true], ['07:30', true], ['12:00', true], ['23:59', true],
    ['24:00', false], ['07:5', false], ['7:30', false], ['abc', false],
    ['12:60', false], ['25:30', false], ['', false], ['12-00', false],
  ])('isValidHHMM(%s) = %s', (input, expected) => {
    expect(isValidHHMM(input)).toBe(expected);
  });

  it('rejeita não-strings', () => {
    expect(isValidHHMM(undefined)).toBe(false);
    expect(isValidHHMM(null)).toBe(false);
    expect(isValidHHMM(1700)).toBe(false);
  });
});
