import { AppError } from '../util/http.js';
import { MCP_TOOLS } from './tools.js';

// MCP endpoint wiring (spec §14): Streamable HTTP at /mcp using the official
// @modelcontextprotocol/sdk, authenticated with OAuth 2.1 (see routes/oauth.ts).
// The bearer is bound to the authorizing user's account, so every tool runs with
// exactly that user's permissions; write tools record an audit entry with
// actor_kind = 'agent'.
//
// TODO(spec §14): build an McpServer, register the MCP_TOOLS catalogue with zod
// input schemas that call into services/*, and connect it to the SDK's
// StreamableHTTPServerTransport, driven from routes/mcp.ts.

export function createMcpServer(): never {
  throw new AppError(
    501,
    'not_implemented',
    `MCP server (${MCP_TOOLS.length} tools) is not wired yet`,
  );
}
