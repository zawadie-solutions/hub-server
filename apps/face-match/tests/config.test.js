import { describe, it, expect } from 'vitest';
import configMod from '../src/config.js';

const { loadSettings } = configMod;

describe('loadSettings', () => {
  it('reads the shipped config, with a possible line below the match line', () => {
    const s = loadSettings({});
    expect(s.matchThreshold).toBe(0.45);
    expect(s.possibleThreshold).toBe(0.2589);
    expect(s.possibleThreshold).toBeLessThan(s.matchThreshold);
    expect(s.matchThresholdSource).toMatch(/Benchmark/);
    expect(s.possibleThresholdSource).toMatch(/FG-NET/);
    expect(s.intraOpThreads).toBe(3);
  });

  it('lets env vars override each line and records where the value came from', () => {
    const s = loadSettings({ FACEMATCH_MATCH_THRESHOLD: '0.6', FACEMATCH_POSSIBLE_THRESHOLD: '0.3', FACEMATCH_THREADS: '2' });
    expect([s.matchThreshold, s.possibleThreshold, s.intraOpThreads]).toEqual([0.6, 0.3, 2]);
    expect(s.matchThresholdSource).toMatch(/env var/);
    expect(s.possibleThresholdSource).toMatch(/env var/);
  });

  it('ignores empty env vars', () => {
    expect(loadSettings({ FACEMATCH_MATCH_THRESHOLD: '' }).matchThreshold).toBe(0.45);
  });

  it.each([
    [{ FACEMATCH_MATCH_THRESHOLD: '1.5' }, /match_threshold/],
    [{ FACEMATCH_POSSIBLE_THRESHOLD: '-1' }, /possible_threshold/],
    [{ FACEMATCH_MATCH_THRESHOLD: 'abc' }, /match_threshold/],
    [{ FACEMATCH_MATCH_THRESHOLD: '0.2' }, /cannot be above/], // possible (0.2589) would sit above the match line
    [{ FACEMATCH_THREADS: '1.5' }, /intra_op_threads/],
  ])('rejects bad settings %j', (env, message) => {
    expect(() => loadSettings(env)).toThrow(message);
  });
});
