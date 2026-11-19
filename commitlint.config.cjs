module.exports = {
  defaultIgnores: false,
  parserPreset: {
    parserOpts: {
      headerPattern: /^([a-z]+)\(([a-z-]+)\)!?: (\S.*)$/,
      breakingHeaderPattern: /^([a-z]+)\(([a-z-]+)\)!: (\S.*)$/,
      headerCorrespondence: ['type', 'scope', 'subject'],
    },
  },
  rules: {
    'type-empty': [2, 'never'],
    'type-enum': [2, 'always', [
      'feat', 'fix', 'refactor', 'perf', 'test', 'docs', 'build', 'ci', 'chore', 'revert',
    ]],
    'scope-empty': [2, 'never'],
    'scope-enum': [2, 'always', [
      'gateway', 'admin-api', 'admin-ui', 'core-ast', 'core-engine', 'security',
      'shared-types', 'db', 'ci', 'deps', 'docs',
    ]],
    'subject-empty': [2, 'never'],
  },
};
