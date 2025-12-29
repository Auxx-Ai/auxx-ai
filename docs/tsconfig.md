## typescript-config/base.json

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Default",
  "compilerOptions": {
    "composite": false,
    "declaration": true, // will generate .d.ts files for every TypeScript
    "declarationMap": true, // Generates a source map for .d.ts files which map back to the original .ts source file. Helps VS Code to link click.
    "esModuleInterop": true, // some ES6 spec fix. recommended true if module is node16, nodenext, or preserve
    "forceConsistentCasingInFileNames": true, // makes sure to respect casing of files
    "inlineSources": false, // when set true, it will include content of .ts file in sourcemaps.
    "isolatedModules": true, // if set namespaces are only allowed in modules
    // moduleResolution:
    // `bundler`: modern resolution; supports TS/ESM-style imports without requiring file extensions in relative imports. Preferred for monorepos.
    // `node16` or `nodenext`: Node ESM resolution.
    // `node10` or `node`: legacy CommonJS resolution.
    // `nodenext`: 
    "moduleResolution": "bundler",

    // default is auto:
    // TypeScript will not only look for import and export statements, but it will also check whether the "type" field in a package.json is set to "module" when running with module: nodenext or node16, and check whether the current file is a JSX file when running under jsx: react-jsx.
    // "moduleDetection": "auto",
    "noUnusedLocals": false, // if true, report errors on unused local variables.
    "noUnusedParameters": false, // if true, Report errors on unused parameters in functions.

    "preserveWatchOutput": true, // used for logging
    "skipLibCheck": true, // helps with performance
    "strict": true, // if true, will follow a bunch of strict checking.
    // strictBindCallApply: true
    // strictBuiltinIteratorReturn: true
    // strictFunctionTypes

    // target:
    // ES6: all modern browser support ES6
    //
    "target": "ES2022",

    // module: Sets the module system for the program
    // `esnext`:
    // `nodenext`:
    // `es2020`:
    "module": "esnext"
  },
  "exclude": ["node_modules"]
}
```

## typescript-config/nextjs.json

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "Next.js",
  "extends": "./base.json",
  "compilerOptions": {
    "allowJs": true, // Allow JavaScript files to be imported inside your project, instead of just .ts and .tsx files.

    "jsx": "preserve", // Emit .jsx files with the JSX unchanged
    "noEmit": true, // Do not emit compiler output files like JavaScript source code, source-maps or declarations.
    "moduleResolution": "bundler",
    "plugins": [{ "name": "next" }],

    // TypeScript includes a default set of type definitions for built-in JS APIs (like Math) and type def's for things found in browser environments (like document)
    // Your program doesn’t run in a browser, so you don’t want the "dom" type definitions
    // dom: DOM definitions - window, document, etc.
    // dom.iterable:
    // esnext: Additional APIs available in ESNext - This changes as the JavaScript specification evolves
    "lib": ["dom", "dom.iterable", "esnext"], //

    // A series of entries which re-map imports to lookup locations rel. to the baseUrl if set, or to the tsconfig file itself otherwise
    // `~/path/to/file` will become `./src/path/to/file`
    // "app/*": ["./src/app/*"],
    // "shared/*": ["./src/app/_shared/*"],
    // "helpers/*": ["./src/helpers/*"],
    "paths": { "~/*": ["./src/*"] }
  },
  // Specifies an array of filenames or patterns to include in the program. These filenames are resolved relative to the directory containing the tsconfig.json file.
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
```

## typescript-config/react-library.json

```json
{
  "$schema": "https://json.schemastore.org/tsconfig",
  "display": "React Library",
  "extends": "./base.json",
  "compilerOptions": {
    "jsx": "react-jsx", // Emit .js files with the JSX changed to _jsx calls optimized for production
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "module": "ESNext",
    "target": "ES2022"
  }
}
```

## apps/web

```json
// tsconfig
{
  "extends": "@auxx/typescript-config/nextjs.json",
  "compilerOptions": {
    // if baseUrl is not set, its the same dir as tsconfig. It's used for `paths`
    "baseUrl": ".",
    // A series of entries which re-map imports to lookup locations rel. to the baseUrl if set, or to the tsconfig file itself otherwise
    "paths": { "~/*": ["./src/*"] },
    // Tells TypeScript to save information about the project graph from the last compilation to files stored on disk.
    // This creates a series of .tsbuildinfo files in the same folder as your compilation output. Can be deleted
    "incremental": true,

    "resolveJsonModule": true // Allows importing modules with a .json extension,
  },
  "include": ["next-env.d.ts", "**/*.ts", "**/*.tsx", ".next/types/**/*.ts"],
  "exclude": ["node_modules"]
}
// package.json
{
  "name": "web",
  "version": "0.1.0",
  "private": true,
  "type": "module",
}
```

## apps/worker

```json
// tsconfig.json
{
  "extends": "@auxx/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "target": "ES2022",
    "rootDir": "./src"
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
// package.json
{
  "name": "worker",
  "version": "0.1.0",
  "private": true,
  "main": "./index.ts",
  "type": "module",
}
```

## packages/db

```json
// tsconfig.json
{
  "extends": "@auxx/typescript-config/base.json",
  "compilerOptions": {
    // If not specified, .js files will be emitted in the same directory as the .ts files they were generated from:
    // example
    // ├── index.js
    // └── index.ts
    // with "outDir": "./dist",
    // ├── dist
    // │   └── index.js
    // ├── index.ts
    // └── tsconfig.json

    "outDir": "./dist",
    // Is used for building your app, weather to include some dir.
    "rootDir": "."
  },
  "include": ["."],
  "exclude": ["node_modules", "dist"]
}
// package.json
```

## packages/config

```json
// tsconfig.json
{
  "extends": "@auxx/typescript-config/base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "rootDir": ".",
    "lib": ["ES2021"],
    "module": "ESNext",
    "moduleResolution": "bundler",
    "target": "ES2021"
  },
  "include": ["src"],
  "exclude": ["node_modules", "dist"]
}
// package.json
{
  "name": "@auxx/config",
  "version": "0.1.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
}
```

## packages/queue

```json
// tsconfig.json
{
  "extends": "@auxx/typescript-config/base.json",
  "compilerOptions": {
    // Lib specific options if needed, often none
    "noEmit": true // Set to false if you build this package
  },
  "include": ["src/**/*.ts"],
  "exclude": ["node_modules"]
}
// package.json
{
  "name": "@auxx/queue",
  "version": "0.0.0",
  "private": true,
  "main": "./src/index.ts",
  "types": "./src/index.ts",
  "exports": {
    ".": "./src/index.ts",
    "./redis": "./src/redis.ts",
    "./config": "./src/config.ts"
  }
}
```

### Module

- Ref: https://www.typescriptlang.org/docs/handbook/modules/reference.html#node16-node18-nodenext
- Control the output module format of emitted js files and other characteristics of how files are imported
-
- **Module format detection**

## module: node16, node18, nodenext

- Supports CommonJS and ESM modules
- {module: 'node16', target: 'es2022', moduleResolution: 'node16'}: doesnt allow imports
- {module: 'node18', target: 'es2022', moduleResolution: 'node16'}: import assertions,
- {module: 'nodenext', target: 'esnext', moduleResolution: 'nodenext'}: doesnt allow import assertions,
- `.mts`/`.mjs`/`.d.mts` files are always ES modules.
- `.cts`/`.cjs`/`.d.cts` files are always CommonJS modules.
- `.ts`/`.tsx`/`.js`/`.jsx`/`.d.ts` files are ES modules if the nearest ancestor package.json file contains "type": "module", otherwise CommonJS modules.
- The detected module format of input .ts/.tsx/.mts/.cts files determines the module format of the emitted JavaScript files. So, for example, a project consisting entirely of .ts files will emit all CommonJS modules by default under --module nodenext, and can be made to emit all ES modules by adding "type": "module" to the project package.json.
- When an ES module references a CommonJS module:
- When a CommonJS module references an ES module: node16 and node18, require cannot reference an ES module.
- `module nodenext` implies and enforces --moduleResolution nodenext.
- `module node18 or node16` implies and enforces --moduleResolution node16.
- `module nodenext` implies --target esnext.
- `module node18 or node16` implies --target es2022.
- `module nodenext or node18 or node16` implies --esModuleInterop.
-

- **module: preserve**

- implies `moduleResolution: bundler` and `esModuleInterop: true`

**module: es2015, es2020, es2022, esnext**

- Use {"module":"esnext", "moduleResolution": "bundler"}: for bundlers, Bun, and tsx.
- Do not use for Node.js. Use node16, node18, or nodenext with "type": "module" in package.json to emit ES modules for Node.js.

\***\*module: commonjs**

- dont use. Use node16, node18, or nodenext

# moduleResolution

- `moduleResolution` controls how TS resolves module specifiers (string literals in import/export/require statements) to files on disk
- Extensionless relative paths are not supported in import paths in Node.js
- `Directory modules (index file resolution)`:

If TypeScript determines that the runtime will perform a lookup for ./dir/index.js given the module specifier "./dir", then ./dir/index.js will undergo extension substitution, and resolve to the file dir/index.ts in this example.

Directory modules may also contain a package.json file, where resolution of the "main" and "types" fields are supported, and take precedence over index.js lookups. The "typesVersions" field is also supported in directory modules.

## paths

- convenience path aliases in their bundler configuration, and then inform TypeScript of those aliases with paths:
- paths does not affect emit
- Can be used for bundled apps, do not use for published libraries
- paths should not point to `monorepo packages` or node_modules packages

## node_modules package lookups

- Every node_modules package lookup has the following structure (beginning after higher precedence bare specifier rules, like paths, baseUrl, self-name imports, and package.json "imports" lookups have been exhausted):

## package.json "exports"

- Note that the presence of "exports" prevents any subpaths not explicitly listed or matched by a pattern in "exports" from being resolved.

## package.json "main" and "types"

## Package-relative file paths

- If neither package.json "exports" nor package.json "typesVersions" apply, subpaths of a bare package specifier resolve relative to the package directory,

## package.json "imports" and self-name imports

- `moduleResolution` is set to `node16`, `nodenext`, or `bundler`
- TypeScript will attempt to resolve import paths beginning with the current package name—that is, the value in the "name" field of the nearest ancestor package.json of the importing file—through the "exports"
- This remapping uses the outDir/declarationDir and rootDir from the tsconfig.json, so using "imports" usually requires an explicit rootDir to be set.

## Ambient modules

- Libs that have been written in js and using them in your ts project.
- **ambient decleration file**:
  - describes the module's types. They are not converted to js later.
  - Simply used for type safety and IntelliSense
  - file format: `d.ts`
  - How to import them?
    1. `DefinitelyTyped` is a repo that contains declaration files contributed and maintained by the TypeScript community
       - npm install --save-dev @types/node
    2. A triple-slash directive is a single-line comment with an XML tag instructing the compiler to include additional files in the compilation process. It usually looks something like this:
       - /// <reference path="../types/sample-module/index.d.ts" />
    3. Configuring typeRoots field in tsconfig file.

## commands

```bash
# See what is included.
pnpm -w tsc -p packages/lib --diagnostics --listFiles
```
