/** Maps each tool to an icon and a human label for the activity feed. */
import type { IconSvgElement } from '@hugeicons/svelte';
import {
	AiBrain01Icon,
	CheckListIcon,
	Calculator01Icon,
	HelpCircleIcon,
	Edit02Icon,
	FileSearchIcon,
	FileSpreadsheetIcon,
	Folder01Icon,
	Note01Icon,
	SearchList01Icon,
	Table01Icon,
	TaskEdit01Icon,
	TextIcon,
	SourceCodeIcon
} from '@hugeicons/core-free-icons';

export interface ToolMeta {
	icon: IconSvgElement;
	/** Present tense, shown while the call is in flight. */
	running: string;
	/** Past tense, shown once it finishes. */
	done: string;
}

const TOOLS: Record<string, ToolMeta> = {
	ocr_document: {
		icon: FileSearchIcon,
		running: 'Reading the document',
		done: 'Read the document'
	},
	import_table: { icon: Table01Icon, running: 'Importing a table', done: 'Imported a table' },
	read_sheet: { icon: SearchList01Icon, running: 'Checking a sheet', done: 'Checked a sheet' },
	edit_cells: { icon: Edit02Icon, running: 'Correcting cells', done: 'Corrected cells' },
	update_sheet: { icon: TaskEdit01Icon, running: 'Adjusting a sheet', done: 'Adjusted a sheet' },
	set_workbook_title: {
		icon: FileSpreadsheetIcon,
		running: 'Finishing the workbook',
		done: 'Finished the workbook'
	},
	check_totals: {
		icon: Calculator01Icon,
		running: 'Checking the totals',
		done: 'Checked the totals'
	},
	run_analysis: {
		icon: SourceCodeIcon,
		running: 'Working it out in code',
		done: 'Worked it out'
	},
	ask_user: { icon: HelpCircleIcon, running: 'Waiting on you', done: 'Asked you' },
	set_formula: { icon: Calculator01Icon, running: 'Writing formulas', done: 'Wrote formulas' },
	write_todos: { icon: CheckListIcon, running: 'Planning', done: 'Updated the plan' },
	task: { icon: AiBrain01Icon, running: 'Delegating to a subagent', done: 'Subagent finished' },
	read_file: { icon: TextIcon, running: 'Reading a file', done: 'Read a file' },
	write_file: { icon: Note01Icon, running: 'Writing a file', done: 'Wrote a file' },
	edit_file: { icon: Edit02Icon, running: 'Editing a file', done: 'Edited a file' },
	ls: { icon: Folder01Icon, running: 'Listing files', done: 'Listed files' },
	glob: { icon: Folder01Icon, running: 'Searching for files', done: 'Searched for files' },
	grep: {
		icon: SearchList01Icon,
		running: 'Searching file contents',
		done: 'Searched file contents'
	}
};

const FALLBACK: ToolMeta = { icon: Note01Icon, running: 'Working', done: 'Done' };

export function toolMeta(name: string): ToolMeta {
	return TOOLS[name] ?? { ...FALLBACK, running: name, done: name };
}

/** A short, specific subtitle built from the call's arguments. */
export function toolDetail(name: string, args: Record<string, unknown> | undefined): string | null {
	if (!args) return null;
	const str = (key: string) => (typeof args[key] === 'string' ? (args[key] as string) : null);

	switch (name) {
		case 'ocr_document':
			return args.pages ? `pages ${args.pages}` : 'every page';
		case 'import_table': {
			const path = str('path');
			return [str('name'), path?.split('/').pop()].filter(Boolean).join(' ← ') || null;
		}
		case 'read_sheet':
			return str('sheet') ?? str('name') ?? 'all sheets';
		case 'edit_cells': {
			const edits = Array.isArray(args.edits) ? args.edits.length : 0;
			return `${edits} cell${edits === 1 ? '' : 's'} in ${str('sheet') ?? 'a sheet'}`;
		}
		case 'update_sheet':
			return str('rename') ? `${str('sheet')} → ${str('rename')}` : str('sheet');
		case 'set_workbook_title':
			return str('title');
		case 'check_totals': {
			const totals = Array.isArray(args.totals) ? args.totals.length : 0;
			const sheet = str('sheet');
			if (!totals) return sheet;
			return `${totals} total${totals === 1 ? '' : 's'}${sheet ? ` on ${sheet}` : ''}`;
		}
		case 'run_analysis':
			return str('reason');
		case 'ask_user':
			return str('question');
		case 'set_formula': {
			const count = Array.isArray(args.formulas) ? args.formulas.length : 0;
			const sheet = str('sheet');
			if (!count) return sheet;
			return `${count} formula${count === 1 ? '' : 's'}${sheet ? ` on ${sheet}` : ''}`;
		}
		case 'task':
			return str('subagent_type') ?? str('description');
		case 'read_file':
		case 'write_file':
		case 'edit_file':
			return str('file_path')?.split('/').pop() ?? null;
		default: {
			/*
			 * An unmapped tool still deserves a readable line. The first
			 * string-valued argument is almost always the interesting one — a
			 * path, a name, a query — and printing a slice of raw JSON instead,
			 * which is what the feed used to fall back to, looks like a bug
			 * rather than transparency.
			 */
			for (const value of Object.values(args)) {
				if (typeof value === 'string' && value.trim()) return value.trim();
			}
			return null;
		}
	}
}
