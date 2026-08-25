# Rowbot

Converts PDFs and images containing tables into multi-sheet Excel workbooks,
with an agent harness whose work is visible to the user.

Read `README.md` first for the architecture; this file covers conventions.

## Stack

SvelteKit 2 (Svelte 5, runes) · Tailwind 4 · shadcn-svelte (`mira`, mauve base)
· Hugeicons · Drizzle + libSQL/Turso · better-auth (email + password only) ·
Deep Agents on GPT-5.6 · Mistral Document AI · ExcelJS · Vercel.

## Where things live

| Path                           | Purpose                                                                                   |
| ------------------------------ | ----------------------------------------------------------------------------------------- |
| `src/lib/types/workbook.ts`    | The workbook model. Shared by agent, grid and exporter — change it here and nowhere else. |
| `src/lib/coerce.ts`            | OCR text → typed values. Runs on both server and client.                                  |
| `src/lib/server/ocr/`          | Mistral client and the HTML-table → grid parser.                                          |
| `src/lib/server/agent/`        | Harness: tools, state, prompt, checkpointer, stream mapper.                               |
| `src/lib/server/xlsx/build.ts` | Workbook model → `.xlsx`.                                                                 |
| `src/lib/types/events.ts`      | The SSE protocol. Both ends import this.                                                  |
| `src/lib/stores/run.svelte.ts` | Client-side run state machine.                                                            |

## Conventions

- **Deterministic work belongs in code, not prompts.** Parsing, typing and
  formatting are tested functions. The agent is for judgement calls.
- **Workbook mutations are `WorkbookOp`s.** Never write a whole `WorkbookModel`
  into agent state — the model issues tool calls in parallel and a last-value
  write drops all but one. See `workbook-ops.ts`.
- **Keep provenance.** When a cell's value changes, preserve `raw` (what the
  page said) and `conf`. The UI and the export both surface it.
- **New tool progress** goes through `emitProgress(runtime)` and needs a variant
  in `ToolProgress` plus a case in `tool-call.svelte`. Add an entry to
  `tool-icon.ts` or the card falls back to the bare tool name.
- Tailwind classes only; no `<style>` blocks. The theme lives in
  `src/routes/layout.css` — use the tokens (`bg-card`, `text-muted-foreground`,
  `border-border`) rather than literal colours, so both themes keep working.

## Testing

`npm run test:unit -- --run` is offline and must stay that way.

Live tests in `src/lib/server/agent/__probe__/` are gated on `ROWBOT_LIVE=1`
because they spend real tokens. Run them after changing anything in
`src/lib/server/agent/` — the stream protocol and subagent state wiring are both
things the type checker cannot verify.

## Svelte MCP server

You have access to the Svelte MCP server with Svelte 5 and SvelteKit docs:

- `list-sections` — call first to discover available documentation.
- `get-documentation` — fetch the sections relevant to the task.
- `svelte-autofixer` — run over any Svelte code before presenting it; keep
  calling until it returns nothing.
- `playground-link` — only on request, and never for code written to files.
