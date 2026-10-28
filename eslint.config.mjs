import obsidian from 'eslint-plugin-obsidianmd';
// The community reviewer uses this recommended preset. Keep unsafe TypeScript
// rules enabled locally as well, even when the hosted scanner downgrades them.
export default [
  {ignores:['node_modules/**','**/*.js','**/*.cjs','**/*.mjs']},
  ...obsidian.configs.recommended,
  {files:['*.ts'],languageOptions:{parserOptions:{project:'./tsconfig.json'}},rules:{
    // esbuild resolves extensionless local TypeScript imports; ESLint's default
    // Node resolver does not. TypeScript checks every import in npm run check.
    'import/no-unresolved':'off',
    'obsidianmd/ui/sentence-case':['warn',{enforceCamelCaseLower:true,
      ignoreWords:['ChatGPT','Inbox','Community','Lite','MCP','OAuth','Contents','Read-only'],
      ignoreRegex:['^https://','^usuario/','^ChatGPT Inbox/']
    }]
  }}
];
