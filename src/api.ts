/**
 * The library surface, for anything that wants the data without the terminal rendering.
 *
 * Each pass is exported on its own because each is useful alone: `resolve` answers *what is loaded
 * here* without reading a transcript, `evidence` answers *what did I call* without reading a config,
 * and `measure` answers *what does it weigh* without either. The ledger is the join, and `fix` turns
 * its verdicts into edits.
 *
 * 🔒 `resolveConfig` returns `{ config, launch }`. Only `config` is safe to serialize: `launch`
 * holds the command lines, environment values and bearer tokens a spawn needs, and it is a `Map`
 * precisely so that `JSON.stringify` on the whole result emits `{}` for it.
 */
export * from './evidence/index.js';
export * from './fix/index.js';
export * from './ledger/index.js';
export * from './measure/index.js';
export * from './resolve/index.js';
export { renderLedger } from './render/ledger.js';
export { renderPlan, renderApplied } from './render/fix.js';
export { colourEnabled, palette } from './render/color.js';
export type { Palette } from './render/color.js';
