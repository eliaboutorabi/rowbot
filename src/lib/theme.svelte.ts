/**
 * Theme preference. The initial class is applied by an inline script in
 * `app.html` so the page never flashes the wrong theme before hydration.
 */
import { browser } from '$app/environment';

export type Theme = 'light' | 'dark';
const STORAGE_KEY = 'rowbot-theme';

function initial(): Theme {
	if (!browser) return 'light';
	return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

class ThemeState {
	current = $state<Theme>(initial());

	set(next: Theme) {
		this.current = next;
		if (!browser) return;
		document.documentElement.classList.toggle('dark', next === 'dark');
		document.documentElement.style.colorScheme = next;
		try {
			localStorage.setItem(STORAGE_KEY, next);
		} catch {
			// Private browsing can refuse writes; the theme just won't persist.
		}
	}

	toggle() {
		this.set(this.current === 'dark' ? 'light' : 'dark');
	}
}

export const theme = new ThemeState();
