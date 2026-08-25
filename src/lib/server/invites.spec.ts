import { describe, expect, it, vi } from 'vitest';

const env: Record<string, string | undefined> = {};
vi.mock('$env/dynamic/private', () => ({ env }));

const { isValidInvite, signUpOpen } = await import('./invites');

describe('invite gate', () => {
	it('is closed when no codes are configured', () => {
		// The fail-safe direction: a missing variable must not open sign-up.
		delete env.ROWBOT_INVITE_CODES;
		expect(signUpOpen()).toBe(false);
		expect(isValidInvite('anything')).toBe(false);

		env.ROWBOT_INVITE_CODES = '   ,  ,';
		expect(signUpOpen()).toBe(false);
	});

	it('accepts a configured code, ignoring case and padding', () => {
		env.ROWBOT_INVITE_CODES = 'rowbot-1234abcd, second-code';
		expect(signUpOpen()).toBe(true);
		expect(isValidInvite('rowbot-1234abcd')).toBe(true);
		expect(isValidInvite('  ROWBOT-1234ABCD  ')).toBe(true);
		expect(isValidInvite('second-code')).toBe(true);
	});

	it('rejects everything else, including the empty string', () => {
		env.ROWBOT_INVITE_CODES = 'rowbot-1234abcd';
		expect(isValidInvite('')).toBe(false);
		expect(isValidInvite('   ')).toBe(false);
		expect(isValidInvite('rowbot-1234abce')).toBe(false);
		expect(isValidInvite('rowbot')).toBe(false);
	});
});
