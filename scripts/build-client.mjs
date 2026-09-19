/**
 * Build `lib/client.js` (the browser bundle DSH serves) from
 * `src/client.template.js`.
 *
 * The client template ships fully self-contained — everything the browser half
 * needs is inlined in the template, and the host exposes the TypeSafe data over
 * same-origin routes rather than a second bundled module, so there is no shared
 * module to weave in. The build step therefore only copies the template
 * verbatim to the served path and pins it there so the two cannot drift apart.
 *
 * Usage: node scripts/build-client.mjs [--check]
 *   --check  verify lib/client.js matches the template; exit 1 if it does not
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const root = dirname(dirname(fileURLToPath(import.meta.url)))
const templatePath = join(root, 'src', 'client.template.js')
const outputPath = join(root, 'lib', 'client.js')

const template = readFileSync(templatePath, 'utf8')

if (process.argv.includes('--check')) {
  const existing = readFileSync(outputPath, 'utf8')
  if (existing !== template) {
    console.error('build-client: lib/client.js is stale — run `npm run build`')
    process.exit(1)
  }
  console.log('build-client: lib/client.js is up to date')
  process.exit(0)
}

writeFileSync(outputPath, template)
console.log('build-client: wrote ' + outputPath + ' (' + Buffer.byteLength(template) + ' bytes)')
