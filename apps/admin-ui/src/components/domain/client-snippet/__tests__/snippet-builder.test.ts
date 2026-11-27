import { describe, expect, it } from 'vitest';
import {
  buildClientSnippet,
  DEFAULT_MCP_GATEWAY_URL,
  PAT_TOKEN_PLACEHOLDER,
  PROFILE_NAME_PLACEHOLDER,
  resolveSnippetToken,
} from '../snippet-builder';

const REAL_SAMPLE_PAT = `mcp_pat_${'deadbeef'.repeat(8)}`;

describe('client-snippet builder', () => {
  it('resolves 3-state token priority: issued > temporary > safe placeholder', () => {
    expect(resolveSnippetToken({})).toEqual({
      token: PAT_TOKEN_PLACEHOLDER,
      mode: 'template',
      isPlaceholder: true,
    });

    expect(resolveSnippetToken({ temporaryToken: `  ${REAL_SAMPLE_PAT}  ` })).toEqual({
      token: REAL_SAMPLE_PAT,
      mode: 'temporary',
      isPlaceholder: false,
    });

    expect(
      resolveSnippetToken({
        issuedToken: REAL_SAMPLE_PAT,
        temporaryToken: 'mcp_pat_ignored',
      }),
    ).toEqual({
      token: REAL_SAMPLE_PAT,
      mode: 'issued',
      isPlaceholder: false,
    });
  });

  it('builds Claude Desktop JSON snippet with placeholder or ephemeral token', () => {
    const defaultSnippet = buildClientSnippet({
      host: 'claude-desktop',
      profileName: 'prod_analytics',
      token: PAT_TOKEN_PLACEHOLDER,
    });
    expect(defaultSnippet.filename).toBe('claude_desktop_config.json');
    const parsed = JSON.parse(defaultSnippet.content) as {
      mcpServers: Record<string, { command: string; args: string[] }>;
    };
    expect(parsed.mcpServers['mysql-prod_analytics']?.command).toBe('npx');
    expect(parsed.mcpServers['mysql-prod_analytics']?.args).toContain(
      `--gateway=${DEFAULT_MCP_GATEWAY_URL}`,
    );
    expect(parsed.mcpServers['mysql-prod_analytics']?.args).toContain(
      `--token=${PAT_TOKEN_PLACEHOLDER}`,
    );
    expect(parsed.mcpServers['mysql-prod_analytics']?.args).toContain(
      '--profile=prod_analytics',
    );

    const filledSnippet = buildClientSnippet({
      host: 'claude-desktop',
      profileName: 'prod_analytics',
      token: REAL_SAMPLE_PAT,
    });
    expect(filledSnippet.content).toContain(`--token=${REAL_SAMPLE_PAT}`);
  });

  it('builds Codex TOML and generic cURL snippets with profile fallback when empty', () => {
    const codex = buildClientSnippet({
      host: 'codex',
      profileName: null,
      token: PAT_TOKEN_PLACEHOLDER,
    });
    expect(codex.filename).toBe('~/.codex/config.toml');
    expect(codex.content).toContain('[mcp_servers."mysql-mcp-gateway"]');
    expect(codex.content).toContain(`Authorization = "Bearer ${PAT_TOKEN_PLACEHOLDER}"`);
    expect(codex.content).toContain(`X-MCP-Profile = "${PROFILE_NAME_PLACEHOLDER}"`);

    const curl = buildClientSnippet({
      host: 'curl',
      profileName: 'stg_order_ro',
      gatewayUrl: 'https://gw.example.internal:8080/',
      token: REAL_SAMPLE_PAT,
    });
    expect(curl.filename).toBe('mcp-tools-list.sh');
    expect(curl.content).toContain("curl -sS -X POST 'https://gw.example.internal:8080/mcp'");
    expect(curl.content).toContain(`Authorization: Bearer ${REAL_SAMPLE_PAT}`);
    expect(curl.content).toContain('X-MCP-Profile: stg_order_ro');
  });
});
