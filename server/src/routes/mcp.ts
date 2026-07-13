import { Hono } from 'hono';
import { notImplemented } from '../util/http.js';

export const mcpRoutes = new Hono();

// Streamable HTTP MCP endpoint (spec §14). Requires an OAuth 2.1 bearer.
// TODO(spec §14): authenticate the bearer (routes/oauth), resolve the user, then
// delegate to the MCP SDK's StreamableHTTPServerTransport wired in mcp/server.ts.
mcpRoutes.all('/', (c) => notImplemented(c, 'mcp_endpoint'));
