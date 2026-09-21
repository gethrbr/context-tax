/**
 * The names a transcript uses for an MCP server, which are not the names a config file uses.
 *
 * A config declares `my.server`. The client prefixes that server's tools `mcp__my_server__`, and a
 * plugin's server `mcp__plugin_<plugin>_<server>__`. Every join between what is configured and what
 * was recorded goes through here, because a join on the declared name alone finds nothing for
 * either of those and reads the silence as a server nobody uses.
 */

/** `mcp__acme__acme_get_knowledge` → `{ server: 'acme', tool: 'acme_get_knowledge' }`. */
export function parseMcpToolName(name: string): { server: string; tool: string } | null {
  if (!name.startsWith('mcp__')) return null;
  const rest = name.slice('mcp__'.length);
  const split = rest.indexOf('__');
  if (split <= 0 || split === rest.length - 2) return null;
  return { server: rest.slice(0, split), tool: rest.slice(split + 2) };
}

/** A server name as the client writes it into a tool name. */
export function toolPrefixName(name: string): string {
  return name.replace(/[^a-zA-Z0-9_-]/g, '_');
}

/**
 * Every key a configured server can appear under in a transcript, most specific first.
 *
 * `plugin` is the plugin id as settings files write it, `name@marketplace`. Only the part before
 * the `@` reaches a tool name.
 */
export function transcriptKeysFor(name: string, plugin: string | null): string[] {
  const keys = [name, toolPrefixName(name)];
  if (plugin !== null) keys.push(`plugin_${toolPrefixName(plugin.split('@')[0])}_${toolPrefixName(name)}`);
  return [...new Set(keys)];
}
