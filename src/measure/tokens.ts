/**
 * Characters to tokens.
 *
 * ⚠️ **PROVISIONAL, and the output says so on every screen that uses it.** `chars / 4` is tuned
 * for English prose. JSON schemas are not prose — quotes, braces, colons and camelCase all
 * fragment into extra tokens — so this ratio is expected to *understate* the single most important
 * number in the ledger. That is the wrong direction to be wrong in, and it is why no dollar figure
 * is printed until `CALIBRATION` below is settled.
 *
 * 🔑 The ratio is **pre-registered**, not fitted. The prediction was written down before the
 * measurement, and `__tests__/measure.test.ts` pins it. Change the constant and that test fails,
 * which is the point: it forces whoever changes it to record what they calibrated against, instead
 * of quietly tuning the number until the output looks plausible.
 *
 * Two things this will never be: `tiktoken` (a native build, which breaks `npx` instant) or a
 * token-counting API call (which breaks the promise that nothing leaves the machine). If chars/4
 * proves worse than ~10% off, the answer is a pure-JS BPE table.
 */

/** The one place the ratio lives. */
export const CHARS_PER_TOKEN = 4;

/**
 * The pre-registered prediction, and what happened when it was tested.
 *
 * 🔬 **Settled by execution on 2026-09-02, and not the way the prediction expected.** The recipe
 * was "run `/context` and read the MCP tools line". Before running it, two differential headless
 * runs measured what an MCP server actually adds to a real Claude Code prompt (2.1.237,
 * `claude-opus-5[1m]`), same repo and same prompt in both arms, `--strict-mcp-config`:
 *
 *   no servers ....................... 35,182 prompt tokens
 *   one acme server ................ 36,152  (+970)
 *   three copies of it ............... 37,917  (+2,735, so +912 each)
 *
 * acme's 8 tools serialize to 12,183 characters, which this file's ratio prices at 3,046 tokens.
 * The measurement is a third of that, and it is linear in the number of servers, so the schemas are
 * **not in the prompt**. A headless session confirmed it in one word: asked whether its
 * `mcp__acme-dev__*` schemas were resident or deferred, it answered `DEFERRED`. 92 of this
 * machine's 120 most recent transcripts contain a `ToolSearch` call, so this is the normal case
 * rather than a headless quirk: the client defers tool schemas and loads them on demand.
 *
 * What the +912 fits is name plus description for the 8 tools: 3,790 characters, which chars/4
 * prices at **948 tokens** against 912–970 measured, a 2–4% error. So the pre-registered ratio
 * survives contact for prose-shaped context; whether a JSON schema tokenizes worse is now
 * unanswerable from `/context`, because the schema never reaches the prompt to be counted.
 *
 * ⚠️ Two things this does NOT settle. `annotations` is moot for resident cost and remains
 * uncounted on the documented grounds that the API's `{name, description, input_schema}` tool shape
 * has no field for it. And the fit above leaves no room for the `instructions` blob, which an
 * interactive session demonstrably does carry (capped, see `INSTRUCTIONS_CAP`), so headless and
 * interactive prompts are not assembled identically, and the per-server number in an interactive
 * session is the higher one.
 *
 * Full workings, including what a dead API key ruled out: `docs/context-tax/CONTEXT_TAX_PLAN.md` §15.
 */
export const CALIBRATION = {
  status: 'measured-against-a-deferring-client',
  method: 'differential headless runs, 2026-09-02, Claude Code 2.1.237 on claude-opus-5[1m]',
  /**
   * acme: 8 tools, 13,136 characters, measured 2026-09-01 on this machine. Raw `tools/list`,
   * `annotations` and array punctuation included, which is why it is larger than the 12,183 the
   * API-shaped count above uses. Kept in its original form because a prediction you edit later is
   * not a prediction.
   */
  prediction: { server: 'acme', chars: 13136, tokens: 3284 },
  /**
   * What a server costs per turn when its schemas are deferred: name and description only.
   * `chars` is acme's 8 names plus its 8 descriptions; `tokens` is what was measured.
   */
  resident: { server: 'acme', chars: 3790, tokens: 912, predictedByRatio: 948 },
} as const;

export function tokens(chars: number): number {
  return Math.round(chars / CHARS_PER_TOKEN);
}

/** One line for every screen that prints a token count, so the caveat travels with the number. */
export const PROVISIONAL_NOTE =
  `token counts are chars/${CHARS_PER_TOKEN}, measured within 4%; a server's schemas are counted` +
  ' whole, which is what you pay only if your client does not defer them';
