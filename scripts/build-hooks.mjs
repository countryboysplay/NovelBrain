import { build } from 'esbuild'

for (const name of ['guard', 'validate']) {
  await build({
    entryPoints: [`src/hooks/${name}.ts`],
    outfile: `resources/hooks/${name}.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    logLevel: 'warning'
  })
}

await build({
  entryPoints: ['src/accept/accept.ts'],
  outfile: 'resources/accept/accept.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  logLevel: 'warning'
})

console.log('hooks built')
