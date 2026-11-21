export type ClientHostKind = 'claude-desktop' | 'codex' | 'curl';

export type SnippetTokenMode = 'issued' | 'template' | 'temporary';

export const PAT_TOKEN_PLACEHOLDER = '<YOUR_SAVED_PAT_TOKEN>';
export const PROFILE_NAME_PLACEHOLDER = '<SELECT_AUTHORIZED_PROFILE>';
export const DEFAULT_MCP_GATEWAY_URL = 'https://mcp.internal.company.com:8080';
export const CLIENT_ADAPTER_PACKAGE = '@company/mysql-mcp-client';

export interface ResolveTokenInput {
  issuedToken?: string | null;
  temporaryToken?: string | null;
}

export interface ResolvedSnippetToken {
  token: string;
  mode: SnippetTokenMode;
  isPlaceholder: boolean;
}

export function resolveSnippetToken({
  issuedToken,
  temporaryToken,
}: ResolveTokenInput): ResolvedSnippetToken {
  const issued = issuedToken?.trim() ?? '';
  if (issued.length > 0) {
    return { token: issued, mode: 'issued', isPlaceholder: false };
  }
  const temporary = temporaryToken?.trim() ?? '';
  if (temporary.length > 0) {
    return { token: temporary, mode: 'temporary', isPlaceholder: false };
  }
  return { token: PAT_TOKEN_PLACEHOLDER, mode: 'template', isPlaceholder: true };
}

export interface BuildSnippetInput {
  host: ClientHostKind;
  profileName?: string | null;
  gatewayUrl?: string;
  token: string;
}

export interface BuiltClientSnippet {
  host: ClientHostKind;
  label: string;
  filename: string;
  content: string;
}

function sanitizeGatewayUrl(raw?: string): string {
  const trimmed = raw?.trim();
  if (!trimmed) return DEFAULT_MCP_GATEWAY_URL;
  return trimmed.replace(/\/+$/, '');
}

function escapeSingleQuotedShell(value: string): string {
  return value.replace(/'/g, "'\\''");
}

function escapeTomlBasicString(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '');
}

export function buildClientSnippet({
  host,
  profileName,
  gatewayUrl,
  token,
}: BuildSnippetInput): BuiltClientSnippet {
  const normalizedGateway = sanitizeGatewayUrl(gatewayUrl);
  const normalizedProfile = profileName?.trim() || PROFILE_NAME_PLACEHOLDER;
  const serverKey =
    normalizedProfile === PROFILE_NAME_PLACEHOLDER
      ? 'mysql-mcp-gateway'
      : `mysql-${normalizedProfile}`;

  if (host === 'claude-desktop') {
    const config = {
      mcpServers: {
        [serverKey]: {
          command: 'npx',
          args: [
            '-y',
            CLIENT_ADAPTER_PACKAGE,
            `--gateway=${normalizedGateway}`,
            `--token=${token}`,
            `--profile=${normalizedProfile}`,
          ],
        },
      },
    };
    return {
      host,
      label: 'Claude Desktop',
      filename: 'claude_desktop_config.json',
      content: JSON.stringify(config, null, 2),
    };
  }

  if (host === 'codex') {
    const escapedKey = escapeTomlBasicString(serverKey);
    const escapedUrl = escapeTomlBasicString(`${normalizedGateway}/mcp`);
    const escapedToken = escapeTomlBasicString(token);
    const escapedProfile = escapeTomlBasicString(normalizedProfile);
    const content = [
      `[mcp_servers."${escapedKey}"]`,
      `url = "${escapedUrl}"`,
      '',
      `[mcp_servers."${escapedKey}".http_headers]`,
      `Authorization = "Bearer ${escapedToken}"`,
      `X-MCP-Profile = "${escapedProfile}"`,
    ].join('\n');
    return {
      host,
      label: 'Codex',
      filename: '~/.codex/config.toml',
      content,
    };
  }

  const safeGateway = escapeSingleQuotedShell(`${normalizedGateway}/mcp`);
  const safeToken = escapeSingleQuotedShell(token);
  const safeProfile = escapeSingleQuotedShell(normalizedProfile);
  const content = [
    `curl -sS -X POST '${safeGateway}' \\`,
    `  -H 'Content-Type: application/json' \\`,
    `  -H 'Accept: application/json, text/event-stream' \\`,
    `  -H 'Authorization: Bearer ${safeToken}' \\`,
    `  -H 'X-MCP-Profile: ${safeProfile}' \\`,
    `  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list","params":{}}'`,
  ].join('\n');

  return {
    host,
    label: '通用 cURL',
    filename: 'mcp-tools-list.sh',
    content,
  };
}
