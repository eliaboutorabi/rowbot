/**
 * Renders the workbook model to a real .xlsx file.
 *
 * The output is meant to be opened in Excel and used, not just looked at:
 * numbers are numbers, percentages are percentages, merged header cells stay
 * merged, header rows are frozen and filterable, and every low-confidence or
 * agent-annotated cell carries a comment explaining itself.
 */
import ExcelJS from 'exceljs';
import type { Cell, Sheet, WorkbookModel } from '$lib/types/workbook';
import { isRightToLeft } from '$lib/sheet-direction';
import { representative } from '$lib/column-layout';
import { normalizeSheet, safeSheetName } from '$lib/types/workbook';

/** Cells read below this confidence get flagged for the reviewer. */
export const LOW_CONFIDENCE = 0.85;

const HEADER_FILL = 'FFF4E9F0';
const HEADER_FONT = 'FF4A1D38';
const LOW_CONF_FILL = 'FFFFF4E5';
const MISMATCH_FILL = 'FFFDE7E7';
const MISMATCH_FONT = 'FF8B1D1D';
const BORDER = 'FFE6DCE3';

/**
 * Column width in Excel character units.
 *
 * One long cell should not set the column, here either: a footnote that ran
 * on used to leave a sixty-character column with fifty-eight characters of
 * whitespace in every other row. Same interquartile rule the grid uses, so
 * the sheet on screen and the file you download are the same shape.
 */
function columnWidth(sheet: Sheet, index: number): number {
	const declared = sheet.columns[index]?.width;
	if (declared) return declared;

	const lengths: number[] = [];
	for (const row of sheet.rows) {
		const cell = row[index];
		if (!cell || cell.v == null) continue;
		lengths.push(Math.min(String(cell.v).length + 2, 60));
	}

	return Math.max(8, representative(lengths));
}

function applyValue(target: ExcelJS.Cell, cell: Cell, columnFormat?: string) {
	// A cell can carry a formula *and* a numeric type — `check_totals` writes
	// SUM() onto a currency total, which is still currency. The formula wins,
	// and the computed value rides along as `result` so viewers that do not
	// recalculate on open still show a number rather than a blank.
	if (cell.f && cell.t !== 'formula') {
		target.value = { formula: cell.f.replace(/^=/, ''), result: cell.v as number };
		const declared = cell.fmt ?? columnFormat;
		if (declared) target.numFmt = declared;
		target.alignment = { horizontal: 'right', vertical: 'middle' };
		return;
	}

	switch (cell.t) {
		case 'blank':
			target.value = null;
			break;
		case 'formula':
			// The cached result matters as much as the formula. Excel recalculates
			// on open, but Numbers, LibreOffice's preview and anything reading the
			// file with a library show whatever value is stored — and with none
			// stored, that is a blank where a total should be.
			target.value = {
				formula: String(cell.f ?? cell.v ?? '').replace(/^=/, ''),
				result: typeof cell.v === 'number' ? cell.v : undefined
			};
			break;
		case 'date': {
			const d = typeof cell.v === 'string' ? new Date(cell.v) : null;
			if (d && !Number.isNaN(d.getTime())) target.value = d;
			else target.value = cell.v as string;
			break;
		}
		case 'boolean':
			target.value = Boolean(cell.v);
			break;
		case 'number':
		case 'currency':
		case 'percent':
			target.value = typeof cell.v === 'number' ? cell.v : Number(cell.v ?? 0);
			break;
		default:
			target.value = cell.v as string;
	}

	const fmt = cell.fmt ?? columnFormat;
	if (fmt && cell.t !== 'text' && cell.t !== 'blank' && cell.t !== 'boolean') {
		target.numFmt = fmt;
	}

	if (cell.t === 'number' || cell.t === 'currency' || cell.t === 'percent') {
		target.alignment = { horizontal: 'right', vertical: 'middle' };
	} else {
		target.alignment = { vertical: 'middle', wrapText: false };
	}
}

/** Comments carry provenance: what the page said, and why we flagged it. */
function annotate(target: ExcelJS.Cell, cell: Cell) {
	const notes: string[] = [];
	const mismatch = cell.check?.status === 'mismatch';

	if (mismatch && cell.check) notes.push(`CHECK THIS — ${cell.check.message}`);
	if (cell.note) notes.push(cell.note);
	if (cell.raw && String(cell.v) !== cell.raw) notes.push(`Source text: "${cell.raw}"`);
	if (cell.conf !== undefined && cell.conf < LOW_CONFIDENCE) {
		notes.push(`Low OCR confidence: ${(cell.conf * 100).toFixed(0)}%`);
	}
	if (!notes.length) return;

	target.note = { texts: [{ text: notes.join('\n') }] };

	// A total that does not reconcile outranks a low-confidence read: it is the
	// one thing in the file a person must look at, so it must survive the trip
	// into Excel rather than living only in Rowbot's UI.
	if (mismatch) {
		target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: MISMATCH_FILL } };
		target.font = { ...(target.font ?? {}), bold: true, color: { argb: MISMATCH_FONT } };
	} else if (cell.conf !== undefined && cell.conf < LOW_CONFIDENCE) {
		target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: LOW_CONF_FILL } };
	}
}

function writeSheet(wb: ExcelJS.Workbook, input: Sheet, taken: string[]) {
	const sheet = normalizeSheet(input);
	const name = safeSheetName(sheet.name, taken);
	taken.push(name);

	const ws = wb.addWorksheet(name, {
		views: [
			{
				state: 'frozen',
				xSplit: sheet.freeze?.cols ?? 0,
				ySplit: sheet.freeze?.rows ?? sheet.headerRows,
				// Excel has the same setting the grid does, and a Persian sheet that
				// opens mirrored is not a faithful transcription of the page.
				rightToLeft: isRightToLeft(sheet)
			}
		]
	});

	ws.columns = sheet.columns.map((_, i) => ({ width: columnWidth(sheet, i) }));

	sheet.rows.forEach((row, r) => {
		const excelRow = ws.getRow(r + 1);
		row.forEach((cell, c) => {
			const target = excelRow.getCell(c + 1);
			// Cells swallowed by a merge must stay empty or Excel rejects the file.
			if (cell.covered) {
				target.value = null;
				return;
			}
			applyValue(target, cell, sheet.columns[c]?.fmt);
			annotate(target, cell);

			if (r < sheet.headerRows) {
				target.font = { bold: true, color: { argb: HEADER_FONT }, size: 11 };
				target.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: HEADER_FILL } };
				target.alignment = { vertical: 'middle', horizontal: 'left', wrapText: true };
			}
			target.border = {
				top: { style: 'thin', color: { argb: BORDER } },
				left: { style: 'thin', color: { argb: BORDER } },
				bottom: { style: 'thin', color: { argb: BORDER } },
				right: { style: 'thin', color: { argb: BORDER } }
			};
		});
		if (r < sheet.headerRows) excelRow.height = 22;
	});

	// Merges are applied after the values so ExcelJS keeps the anchor's content.
	sheet.rows.forEach((row, r) => {
		row.forEach((cell, c) => {
			const span = cell.merge;
			if (!span || (span.rs <= 1 && span.cs <= 1)) return;
			const bottom = Math.min(r + span.rs, sheet.rows.length) - 1;
			const right = Math.min(c + span.cs, sheet.columns.length) - 1;
			if (bottom <= r && right <= c) return;
			try {
				ws.mergeCells(r + 1, c + 1, bottom + 1, right + 1);
			} catch {
				// Overlapping spans from a misread table shouldn't break the export.
			}
		});
	});

	if (sheet.headerRows > 0 && sheet.rows.length > sheet.headerRows) {
		ws.autoFilter = {
			from: { row: sheet.headerRows, column: 1 },
			to: { row: sheet.rows.length, column: Math.max(sheet.columns.length, 1) }
		};
	}

	if (sheet.notes) {
		const cell = ws.getCell(1, 1);
		const existing = cell.note;
		if (!existing) cell.note = { texts: [{ text: sheet.notes }] };
	}

	return name;
}

export async function buildWorkbook(model: WorkbookModel): Promise<Uint8Array> {
	const wb = new ExcelJS.Workbook();
	wb.creator = 'Rowbot';
	wb.lastModifiedBy = 'Rowbot';
	wb.created = new Date();
	wb.modified = new Date();
	// Recalculate everything when the file opens. Cross-sheet formulas are
	// written with the value Rowbot computed, but a reader who edits a source
	// figure should see the summary follow it without pressing anything.
	wb.calcProperties.fullCalcOnLoad = true;

	const taken: string[] = [];
	if (!model.sheets.length) {
		wb.addWorksheet('Sheet1');
	} else {
		for (const sheet of model.sheets) writeSheet(wb, sheet, taken);
	}

	const buffer = await wb.xlsx.writeBuffer();
	return new Uint8Array(buffer as ArrayBuffer);
}

/** Filename for the download, derived from the document name. */
/**
 * Characters a filesystem genuinely objects to, plus the control range.
 * Windows is the strict one; everything here is illegal there.
 */
// eslint-disable-next-line no-control-regex -- the control range is the point
const ILLEGAL = /[\u0000-\u001f\u007f<>:"/\\|?*]+/g;

/**
 * A filename for the downloaded workbook.
 *
 * Only what a filesystem actually refuses is taken out. The old allow-list of
 * `[\w\s.-]` deleted everything else, which cost two things worth having: an
 * em dash in an English title left the double space behind it, and a Persian
 * title — this application reads Persian documents — lost every character it
 * had and came out as `rowbot.xlsx`.
 */
export function workbookFilename(title: string): string {
	const base =
		title
			.replace(/\.[a-z0-9]+$/i, '')
			.replace(ILLEGAL, ' ')
			.replace(/\s+/g, ' ')
			// A name starting with a dot is hidden on Unix, which is a poor thing
			// to do to somebody's download.
			.replace(/^[.\s]+/, '')
			.trim() || 'rowbot';
	return `${base.slice(0, 80).trim()}.xlsx`;
}

/**
 * A `content-disposition` value that survives a non-Latin filename.
 *
 * Header values are Latin-1, so a Persian name cannot go in the plain
 * `filename=` parameter at all — the runtime rejects the header rather than
 * send it. RFC 6266 is written for exactly this: an ASCII fallback for
 * anything that predates the rule, and a percent-encoded UTF-8 `filename*`
 * that every current browser prefers when both are present.
 */
export function contentDisposition(filename: string): string {
	const stripped = filename
		.replace(/[^\x20-\x7e]/g, '')
		.replace(/["\s]+/g, ' ')
		.trim();
	// A wholly Persian name leaves nothing but the extension, and `.xlsx` alone
	// is a hidden file rather than a fallback.
	const named = /[A-Za-z0-9]/.test(stripped.replace(/\.[a-z0-9]+$/i, ''));
	const ascii = named ? stripped : 'workbook.xlsx';

	// `encodeURIComponent` leaves ' ( ) * alone and RFC 5987 does not allow them.
	const encoded = encodeURIComponent(filename).replace(
		/['()*]/g,
		(c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
	);

	return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}
