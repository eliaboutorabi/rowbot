import { error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { latestWorkbook, ownedDocument } from '$lib/server/runs';
import { buildWorkbook, workbookFilename } from '$lib/server/xlsx/build';
import type { WorkbookModel } from '$lib/types/workbook';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export const GET: RequestHandler = async ({ params, locals }) => {
	if (!locals.user) error(401, 'Sign in first.');

	const doc = await ownedDocument(params.documentId, locals.user.id);
	const saved = await latestWorkbook(doc.id);
	if (!saved) error(404, 'There is no workbook to export yet.');

	const model = saved.dataJson as WorkbookModel;
	const bytes = await buildWorkbook(model);
	const filename = workbookFilename(model.title || doc.name);

	return new Response(bytes as unknown as BodyInit, {
		headers: {
			'content-type': XLSX_MIME,
			// The quoted form keeps spaces in the filename intact.
			'content-disposition': `attachment; filename="${filename}"`,
			'content-length': String(bytes.byteLength),
			'cache-control': 'no-store'
		}
	});
};
