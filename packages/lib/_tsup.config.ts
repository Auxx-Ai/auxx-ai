import { defineConfig } from 'tsup'

export default defineConfig({
  entry: ['src/index.ts', 'src/**/*.ts'],
  // entry: ['src/index.ts'],
  outDir: 'dist',
  format: ['esm', 'cjs'],
  // dts: true,
  clean: true,
  target: 'node18',
  watch: process.env.TSUP_WATCH === 'true', // only watch when you ask
  splitting: false, // fewer chunks → less memory
})

// export default defineConfig({
//   entry: ['src/index.ts'], // your “main” entry
//   format: ['cjs', 'esm'],
//   dts: true,
//   outDir: 'dist',
//   clean: true,
//   bundle: false, // ← turn OFF bundling
//   // esbuildOptions(options) {
//   // preserveModules turns: src/foo/bar.ts → dist/foo/bar.js
//   // options.preserveModules = true
//   // options.preserveModulesRoot = 'src'
//   // return options
//   // },
//   watch: process.env.TSUP_WATCH === 'true',
// })
