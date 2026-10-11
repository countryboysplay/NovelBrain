import { build } from 'esbuild'

for (const name of ['guard', 'validate', 'memory']) {
  await build({
    entryPoints: [`src/hooks/${name}.ts`],
    outfile: `resources/hooks/${name}.mjs`,
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node22',
    banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
    preserveSymlinks: true, // a worktree's node_modules junction must not leak its target path into the bundles
    logLevel: 'warning'
  })
}

await build({
  entryPoints: ['src/accept/accept.ts'],
  outfile: 'resources/accept/accept.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  banner: { js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);" },
  preserveSymlinks: true,
  logLevel: 'warning'
})

console.log('hooks built')
