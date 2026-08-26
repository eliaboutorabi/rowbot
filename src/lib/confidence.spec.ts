import { describe, expect, it } from 'vitest';
import {
	confidenceColor,
	confidenceGradient,
	confidencePercent,
	confidenceTint,
	confidenceWords
} from './confidence';

/** `oklch(L C H)` → the hue, which is what carries good-to-bad here. */
const hue = (css: string) => Number(/oklch\([\d.]+ [\d.]+ ([\d.]+)/.exec(css)![1]);
const alpha = (css: string) => Number(/\/ ([\d.]+)\)/.exec(css)?.[1] ?? 1);

describe('confidenceColor', () => {
	it('runs green at the top and red at the bottom', () => {
		expect(hue(confidenceColor(1))).toBeGreaterThan(140);
		expect(hue(confidenceColor(0.8))).toBeLessThan(40);
	});

	it('separates the values that actually occur', () => {
		// The whole point: 99% and 91% are the range real documents live in,
		// and a three-band legend put both in the same band.
		expect(hue(confidenceColor(0.99))).toBeGreaterThan(hue(confidenceColor(0.91)) + 40);
	});

	it('moves in one direction the whole way up', () => {
		const hues = [0.8, 0.85, 0.9, 0.93, 0.96, 0.98, 1].map((c) => hue(confidenceColor(c)));
		for (let i = 1; i < hues.length; i++) expect(hues[i]).toBeGreaterThan(hues[i - 1]);
	});

	it('clamps rather than extrapolating off the end', () => {
		expect(confidenceColor(-5)).toBe(confidenceColor(0));
		expect(confidenceColor(9)).toBe(confidenceColor(1));
	});

	it('has nothing worse to say below 0.8', () => {
		expect(confidenceColor(0.4)).toBe(confidenceColor(0.8));
	});
});

describe('confidenceTint', () => {
	it('keeps a clean cell quiet', () => {
		expect(alpha(confidenceTint(1))).toBeLessThan(0.16);
	});

	it('marks a doubtful one clearly', () => {
		expect(alpha(confidenceTint(0.8))).toBeGreaterThan(0.3);
	});

	it('never gets so strong it hides the figure', () => {
		expect(alpha(confidenceTint(0))).toBeLessThanOrEqual(0.5);
	});
});

describe('confidencePercent', () => {
	it('always carries the per cent sign, so the number cannot be read as anything else', () => {
		expect(confidencePercent(0.982)).toBe('98.2%');
		expect(confidencePercent(1)).toBe('100.0%');
	});
});

describe('confidenceGradient', () => {
	it('is a left-to-right ramp with stops at both ends', () => {
		const css = confidenceGradient();
		expect(css.startsWith('linear-gradient(to right,')).toBe(true);
		expect(css).toContain('0%');
		expect(css).toContain('100%');
	});
});

describe('confidenceWords', () => {
	it('says something different at each end', () => {
		expect(confidenceWords(0.995)).toBe('read cleanly');
		expect(confidenceWords(0.92)).toBe('slightly unsure');
		expect(confidenceWords(0.5)).toBe('barely legible — check this');
	});
});
