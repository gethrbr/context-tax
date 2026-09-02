/**
 * A real MCP server over stdio, small enough to read in one sitting.
 *
 * The client is the part of this package most likely to be quietly wrong, because the failure mode
 * is a server that answers in a shape we did not expect and a row that comes back empty. Mocking
 * the transport would test the mock. This speaks the actual protocol.
 *
 * Argument 2, when present, is a path to write this process's pid to. A test that starts this
 * through a shell wrapper needs the pid of the real server, not of the wrapper, to prove the whole
 * tree was taken down.
 *
 * Argument 1 selects the behaviour a test needs:
 *   ok        two tools, an instructions blob, and one tool carrying `annotations`
 *   verbose   the same, with an instructions blob longer than the client will show the model
 *   sticky    the same, but it holds a timer open so closing its stdin is not enough to end it,
 *             which is how a real MCP server behaves and why the wrapper has to be signalled
 *   paged     the same tools handed over in two pages, to exercise `nextCursor`
 *   noisy     a line of plain-text logging on stdout before every response
 *   crash     exits 1 with a message on stderr, like a package that does not exist
 *   hang      accepts the connection and never answers
 */

import { writeFileSync } from 'node:fs';

const mode = process.argv[2] ?? 'ok';
const pidFile = process.argv[3];
if (pidFile !== undefined) writeFileSync(pidFile, String(process.pid));
// A server with work of its own does not stop just because the pipe went quiet. Neither does this.
if (mode === 'sticky') setInterval(() => {}, 60_000);

if (mode === 'crash') {
  process.stderr.write('some-tool error 404 not found\n');
  process.exit(1);
}

const TOOLS = [
  {
    name: 'alpha',
    description: 'The first tool.',
    inputSchema: { type: 'object', properties: { one: { type: 'string' } } },
  },
  {
    name: 'beta',
    description: 'The second tool.',
    inputSchema: { type: 'object', properties: {} },
    // Client-side metadata. The Anthropic API has no field for it, so it must not be costed.
    annotations: { title: 'Beta', readOnlyHint: true, destructiveHint: false },
  },
];

const INSTRUCTIONS = 'Server instructions that land in the system prompt.';
/** Over `INSTRUCTIONS_CAP`, so the truncation the client performs has something to bite on. */
const LONG_INSTRUCTIONS = `${INSTRUCTIONS} `.repeat(60);

const send = (message) => {
  if (mode === 'noisy') process.stdout.write('listening on stdio\n');
  process.stdout.write(`${JSON.stringify(message)}\n`);
};

let buffer = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  buffer += chunk;
  const lines = buffer.split('\n');
  buffer = lines.pop() ?? '';
  for (const line of lines) {
    if (line.trim() === '') continue;
    const request = JSON.parse(line);
    if (mode === 'hang') continue;

    if (request.method === 'initialize') {
      send({
        jsonrpc: '2.0',
        id: request.id,
        result: {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'fixture', version: '1.0.0' },
          instructions: mode === 'verbose' ? LONG_INSTRUCTIONS : INSTRUCTIONS,
        },
      });
      continue;
    }

    if (request.method === 'tools/list') {
      if (mode !== 'paged') {
        send({ jsonrpc: '2.0', id: request.id, result: { tools: TOOLS } });
        continue;
      }
      const cursor = request.params?.cursor ?? null;
      send(
        cursor === null
          ? { jsonrpc: '2.0', id: request.id, result: { tools: [TOOLS[0]], nextCursor: 'page-2' } }
          : { jsonrpc: '2.0', id: request.id, result: { tools: [TOOLS[1]] } },
      );
    }
  }
});
