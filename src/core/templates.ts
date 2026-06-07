/**
 * Xurgo Atlas init templates.
 *
 * Each template seeds a curated set of documentation files for common
 * project archetypes. Templates are purely additive: they create files
 * that do not yet exist and never overwrite existing content.
 */

import YAML from 'yaml';

// ── Types ────────────────────────────────────────────────────────────────

export interface TemplateFile {
  /** Relative path from the project root (e.g. "docs/project-brief.md"). */
  path: string;
  /** File content as a string. */
  content: string;
}

export interface TemplateDefinition {
  /** Short identifier (e.g. "saas", "cli-tool"). */
  name: string;
  /** One-line description shown in help / listing. */
  description: string;
  /** Additional files beyond the standard init set. */
  files: TemplateFile[];
}

// ── Manifest helpers ─────────────────────────────────────────────────────

/**
 * Build the docs/manifest.yml content for a given set of template files.
 * The returned YAML includes the standard entrypoints plus each
 * template-specific file as a curated document entry.
 */
export function buildManifestYaml(templateFiles: TemplateFile[]): string {
  const docEntries = [
    {
      path: 'STATUS.md',
      role: 'front-page',
      priority: 'highest',
      summary: 'Project front page with current focus, next actions, and blockers',
    },
    {
      path: 'AGENTS.md',
      role: 'agent-contract',
      priority: 'highest',
      summary: 'Agent safety rules and operating guidelines',
      related: ['.docs-policy.yml'],
    },
    {
      path: '.docs-policy.yml',
      role: 'safety-policy',
      priority: 'highest',
      summary: 'Configurable risk detection and protected path rules',
      related: ['AGENTS.md'],
    },
    {
      path: 'docs/manifest.yml',
      role: 'project-map',
      priority: 'highest',
      summary: 'Machine-readable project document index',
    },
    {
      path: 'docs/README.md',
      role: 'reference',
      priority: 'high',
      summary: 'Project documentation overview',
    },
    {
      path: 'docs/implementation-checklist.md',
      role: 'roadmap',
      priority: 'high',
      summary: 'Implementation status for all features and milestones',
    },
  ];

  // Add template-specific doc entries
  for (const f of templateFiles) {
    docEntries.push({
      path: f.path,
      role: deriveRole(f.path),
      priority: 'medium' as const,
      summary: deriveSummary(f.path),
    });
  }

  const manifest: Record<string, unknown> = {
    version: 1,
    entrypoints: [
      { path: 'STATUS.md', role: 'front-page', priority: 'highest' },
    ],
    documents: docEntries,
  };

  return [
    '# Xurgo Atlas manifest — machine-readable project document index',
    YAML.stringify(manifest, { indent: 2 }).trimEnd(),
    '',
  ].join('\n');
}

function deriveRole(filePath: string): string {
  if (filePath.includes('architecture')) return 'reference';
  if (filePath.includes('project-brief')) return 'brief';
  if (filePath.includes('product-brief')) return 'brief';
  if (filePath.includes('development-workflow')) return 'guide';
  if (filePath.includes('mcp-surface')) return 'reference';
  if (filePath.includes('cli-surface')) return 'reference';
  if (filePath.includes('web-app-structure')) return 'reference';
  return 'notes';
}

function deriveSummary(filePath: string): string {
  const name = filePath.split('/').pop()?.replace(/\.md$/, '') ?? filePath;
  const readable = name.replace(/[-_]/g, ' ');
  return `Template-generated: ${readable}`;
}

// ── Template definitions ─────────────────────────────────────────────────

const TEMPLATE_DEFAULT_FILES: TemplateFile[] = [
  {
    path: 'docs/project-brief.md',
    content: `# Project Brief

## Overview

<!-- Briefly describe the project, its purpose, and what it does. -->

## Goals

<!-- List the primary goals of this project. -->

## Scope

<!-- Define what is in scope and what is out of scope. -->

## Stakeholders

<!-- Who are the key stakeholders and decision-makers? -->
`,
  },
];

const TEMPLATE_SAAS_FILES: TemplateFile[] = [
  {
    path: 'docs/product-brief.md',
    content: `# Product Brief

## Overview

<!-- One-paragraph description of the SaaS product. -->

## Target Users

<!-- Who is this product for? Describe the primary persona(s). -->

## MVP Scope

<!-- What features are essential for the first release? -->

- [ ] Feature A
- [ ] Feature B
- [ ] Feature C

## Non-Goals

<!-- What is explicitly out of scope for v1? -->

## Risks

<!-- Key risks to delivery, adoption, or operation. -->

## Success Metrics

<!-- How will we measure success? (e.g. MAU, retention, revenue) -->
`,
  },
  {
    path: 'docs/development-workflow.md',
    content: `# Development Workflow

## Branch Strategy

- \`main\` — production-ready, protected
- \`staging\` — pre-production validation
- \`feat/*\` — feature branches, merged via PR

## CI / CD

<!-- Describe the CI pipeline steps, test requirements, and deployment targets. -->

## Release Process

1. Feature branch merged to \`main\`
2. CI passes full test suite
3. Staging deployment validated
4. Production release tagged
`,
  },
];

const TEMPLATE_CLI_TOOL_FILES: TemplateFile[] = [
  {
    path: 'docs/cli-surface.md',
    content: `# CLI Surface

## Command Structure

<!-- Document the top-level commands and subcommands. -->

\`\`\`
my-tool <command> [options]
\`\`\`

## Flags

<!-- Global flags and per-command flags. -->

| Flag | Short | Description |
|------|-------|-------------|
| \`--help\` | \`-h\` | Show help |
| \`--version\` | \`-v\` | Show version |
| \`--config\` | \`-c\` | Config file path |

## Exit Codes

| Code | Meaning |
|------|---------|
| 0    | Success |
| 1    | General error |
| 2    | Invalid input |
`,
  },
  {
    path: 'docs/development-workflow.md',
    content: `# Development Workflow

## Validation

- \`npm run lint\`
- \`npm test\`
- \`npm run build\`

## Packaging

<!-- How is the tool packaged and distributed? (npm, homebrew, binary, etc.) -->

## Release

1. Update version
2. Run full validation suite
3. Tag release
4. Publish package
`,
  },
];

const TEMPLATE_MCP_SERVER_FILES: TemplateFile[] = [
  {
    path: 'docs/mcp-surface.md',
    content: `# MCP Surface

## Tools

<!-- List MCP tools exposed by this server. -->

| Tool | Description |
|------|-------------|
| \`example_tool\` | Brief description |

## Resources

<!-- List MCP resources (URI templates, static resources). -->

| Resource URI | Description |
|--------------|-------------|
| \`example://{id}\` | Dynamic resource description |

## Daemon / Client Setup

Start the server:

\`\`\`
npx my-mcp-server
\`\`\`

MCP client config:

\`\`\`json
{
  "mcpServers": {
    "my-server": {
      "command": "npx",
      "args": ["my-mcp-server"]
    }
  }
}
\`\`\`

## Safety Boundaries

<!-- What operations are read-only? What requires approval? -->
`,
  },
  {
    path: 'docs/development-workflow.md',
    content: `# Development Workflow

## Local Development

- \`npm run dev\` — watch mode with auto-reload
- \`npm test\` — run test suite
- \`npm run build\` — compile TypeScript

## Daemon Lifecycle

- Start: \`npm start\` or direct invocation
- Health: \`curl http://localhost:PORT/health\`
- Stop: SIGTERM or \`npm stop\`

## Release

1. Run full validation
2. Bump version
3. Tag and publish to npm
`,
  },
];

const TEMPLATE_WEB_APP_FILES: TemplateFile[] = [
  {
    path: 'docs/product-brief.md',
    content: `# Product Brief

## Overview

<!-- One-paragraph description of the web application. -->

## Target Users

<!-- Describe primary and secondary user personas. -->

## Core Features

- [ ] Feature 1
- [ ] Feature 2
- [ ] Feature 3

## Success Metrics

<!-- How will we know if the product is successful? -->
`,
  },
  {
    path: 'docs/web-app-structure.md',
    content: `# Web App Structure

## Routes / Screens

| Path | Screen | Auth |
|------|--------|------|
| \`/\` | Home | No |
| \`/login\` | Login | No |
| \`/dashboard\` | Dashboard | Yes |

## Frontend Architecture

<!-- Framework, state management, component library, routing approach. -->

## State / Data Notes

<!-- Describe data fetching strategy, cache invalidation, optimistic updates. -->

## API Surface

<!-- Document the main API endpoints consumed by the frontend. -->
`,
  },
  {
    path: 'docs/development-workflow.md',
    content: `# Development Workflow

## Branch Strategy

- \`main\` — production
- \`develop\` — integration
- \`feat/*\` — feature branches

## CI / CD Pipeline

<!-- Lint, test, build, deploy steps. -->

## Release Process

1. Feature complete on \`develop\`
2. QA validation on staging
3. PR to \`main\`
4. Production deploy
`,
  },
];

// ── Registry ─────────────────────────────────────────────────────────────

export const TEMPLATES: Record<string, TemplateDefinition> = {
  default: {
    name: 'default',
    description: 'Generic project with standard Atlas docs and project brief',
    files: TEMPLATE_DEFAULT_FILES,
  },
  saas: {
    name: 'saas',
    description: 'SaaS product with product brief, MVP scope, and development workflow',
    files: TEMPLATE_SAAS_FILES,
  },
  'cli-tool': {
    name: 'cli-tool',
    description: 'CLI tool with command surface docs, packaging notes, and validation workflow',
    files: TEMPLATE_CLI_TOOL_FILES,
  },
  'mcp-server': {
    name: 'mcp-server',
    description: 'MCP server with tool/resource surface, daemon setup, and safety boundaries',
    files: TEMPLATE_MCP_SERVER_FILES,
  },
  'web-app': {
    name: 'web-app',
    description: 'Web application with product brief, route structure, and frontend architecture',
    files: TEMPLATE_WEB_APP_FILES,
  },
};

export const TEMPLATE_NAMES: string[] = Object.keys(TEMPLATES);

// ── Helpers ──────────────────────────────────────────────────────────────

export function getTemplate(name: string): TemplateDefinition | undefined {
  return TEMPLATES[name];
}

export function isValidTemplate(name: string): boolean {
  return name in TEMPLATES;
}

export function getTemplateListText(): string {
  const lines = ['Available init templates:'];
  for (const t of TEMPLATE_NAMES) {
    const def = TEMPLATES[t];
    const extraFiles = def.files.map((f) => `  docs/${f.path.replace('docs/', '')}`).join('\n');
    lines.push('');
    lines.push(`  ${t}`);
    lines.push(`    ${def.description}`);
    if (def.files.length > 0) {
      lines.push(`    Creates:`);
      for (const f of def.files) {
        lines.push(`      ${f.path}`);
      }
    }
  }
  return lines.join('\n');
}
