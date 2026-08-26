/**
 * What the workbook asks the source view to reveal.
 *
 * Its own module because both sides of the crossing need the shape and
 * neither should have to import the other's component to get it.
 */
export interface SourceFocus {
	/** The OCR table to scroll to. */
	tablePath: string;
	/**
	 * A nonce. Without it, asking for the same table twice is no change at all
	 * and the second click does nothing.
	 */
	nonce: number;
	/** The cell to pick out on the page, when one is selected. */
	cell?: {
		/** The typed value, and what the reader saw, which may be formatted differently. */
		text: string;
		raw?: string;
		/** Position within that page's own table, header included. */
		row?: number;
		rows?: number;
	};
}
