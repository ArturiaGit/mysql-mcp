import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const normalize = (value) => value.replaceAll('\\', '/').toLowerCase();
const mysql = /(?:^|\/)mysql2(?:\/|$)/;
const apps = /(?:^|\/)apps\//;
const backend = /(?:^|\/)(?:packages\/(?:security|core-ast|core-engine)|apps\/(?:admin-api|gateway)|@mysql-mcp\/(?:security|core-ast|core-engine|admin-api|gateway))(?:\/|$)/;
const namedApp = /^@mysql-mcp\/(?:admin-api|gateway|admin-ui)(?:\/|$)/;
const zod = /(?:^|\/)zod(?:\/|$)/;

export const moduleBoundaries = {
  meta: { schema: [], messages: { forbidden: 'Import violates the M0 module boundary.', dynamic: 'Use a literal module specifier so workspace boundaries can be checked.' } },
  create(context) {
    const p = normalize(path.relative(root, context.filename));
    const shared = p.startsWith('packages/shared-types/');
    const frontend = p.startsWith('apps/admin-ui/');
    const workspaceCode = p.startsWith('packages/') || p.startsWith('apps/');
    const driver = p === 'packages/core-engine/src/metadata-pool.ts';
    function check(node, source) {
      const literal = source?.type === 'Literal' ? source.value : undefined;
      if (typeof literal !== 'string') {
        if (workspaceCode) context.report({ node, messageId: 'dynamic' });
        return;
      }
      const raw = normalize(literal);
      const spec = raw.startsWith('.') ? normalize(path.relative(root, path.resolve(path.dirname(context.filename), raw))) : raw;
      if ((!driver && mysql.test(spec)) ||
          (p.startsWith('packages/') && (apps.test(spec) || namedApp.test(spec))) ||
          (frontend && backend.test(spec)) ||
          (shared && (zod.test(spec) || !raw.startsWith('.') || !spec.startsWith('packages/shared-types/')))) {
        context.report({ node, messageId: 'forbidden' });
      }
    }
    const checkSource = (node) => { if (node.source) check(node, node.source); };
    return {
      ImportDeclaration: checkSource,
      ExportNamedDeclaration: checkSource,
      ExportAllDeclaration: checkSource,
      ImportExpression: checkSource,
      TSImportType: (node) => check(node, node.source?.literal ?? node.parameter?.literal ?? node.argument?.literal ?? node.source),
      TSExternalModuleReference: (node) => check(node, node.expression),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node, node.arguments[0]);
      },
    };
  },
};

export const typesOnly = {
  meta: { schema: [], messages: { runtime: 'shared-types may contain only TypeScript type declarations/imports/exports.' } },
  create(context) {
    const isType = (node) => ['TSInterfaceDeclaration', 'TSTypeAliasDeclaration'].includes(node?.type);
    return {
      Program(program) {
        if (!/\.ts$/i.test(context.filename)) {
          context.report({ node: program, messageId: 'runtime' });
          return;
        }
        for (const node of program.body) {
          if (!(isType(node) ||
                (node.type === 'ImportDeclaration' && node.importKind === 'type') ||
                (node.type === 'ExportNamedDeclaration' && (node.exportKind === 'type' || isType(node.declaration))) ||
                (node.type === 'ExportAllDeclaration' && node.exportKind === 'type'))) {
            context.report({ node, messageId: 'runtime' });
          }
        }
      },
    };
  },
};
