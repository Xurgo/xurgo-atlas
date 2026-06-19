import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { version } = require('../package.json') as { version: string };

export const PACKAGE_NAME = 'xurgo-atlas';

export function getVersionLine(): string {
  return `${PACKAGE_NAME} ${version}`;
}

export function printVersion(): void {
  console.log(getVersionLine());
}
