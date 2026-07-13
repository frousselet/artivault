import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { Context } from 'hono';
import { Hono } from 'hono';
import { config } from '../config/env.js';
import { buildMcpServer } from '../mcp/server.js';
import { validateAccessToken } from '../services/oauth.js';
import { getUserById } from '../services/users.js';

export const mcpRoutes = new Hono();

const resourceMetadata = `${config.PUBLIC_BASE_URL.replace(/\/+$/, '')}/.well-known/oauth-protected-resource`;

function unauthorized(c: Context) {
  c.header('WWW-Authenticate', `Bearer resource_metadata="${resourceMetadata}"`);
  return c.json({ error: 'unauthorized' }, 401);
}

// Streamable HTTP MCP endpoint (spec §14). OAuth 2.1 bearer → user; the tools run
// as that user. Stateless JSON mode: a fresh server/transport per request.
mcpRoutes.all('/', async (c) => {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(.+)$/i)?.[1];
  if (!token) return unauthorized(c);
  const ctx = validateAccessToken(token);
  if (!ctx) return unauthorized(c);
  const user = getUserById(ctx.userId);
  if (!user || user.disabled) return unauthorized(c);

  const server = buildMcpServer(user);
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(c.req.raw);
});
