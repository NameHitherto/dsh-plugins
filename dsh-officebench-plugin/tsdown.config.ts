import { defineConfig } from 'tsdown'
import { CLIENT_STYLESHEET } from './src/client/styles.ts'

const PLATFORM_EXTERNALS = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  'zod',
  '@tanstack/react-virtual',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
]

const HOST_EXTERNALS: (string | RegExp)[] = [
  /^@deepseek-ai\//,
  'exceljs',
  'jszip',
  'pdf-lib',
  'postal-mime',
  'tesseract.js',
  'unpdf',
]

const stylesheetMeta = `, meta: () => ({ stylesheets: { 'officebench.css': { text: () => ${JSON.stringify(CLIENT_STYLESHEET)} } } })`

export default defineConfig([
  {
    name: 'dsh-officebench-plugin/host',
    entry: {
      index: 'src/index.ts',
      'tools-plugin': 'src/tools-plugin.ts',
    },
    outDir: 'lib',
    format: ['esm'],
    platform: 'node',
    target: 'es2024',
    sourcemap: true,
    fixedExtension: false,
    dts: false,
    clean: false,
    deps: {
      neverBundle: HOST_EXTERNALS,
    },
    outputOptions: {
      chunkFileNames: 'shared-[name].js',
    },
  },
  {
    name: 'dsh-officebench-plugin/client',
    entry: {
      client: 'src/client/index.tsx',
    },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2024',
    sourcemap: true,
    minify: { compress: false, mangle: false },
    dts: false,
    clean: false,
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
    },
    deps: {
      neverBundle: PLATFORM_EXTERNALS,
      alwaysBundle: (specifier: string) => !PLATFORM_EXTERNALS.includes(specifier),
    },
    outputOptions: {
      entryFileNames: 'client.js',
      banner: 'window.__ModuleLoader__.load({ id: "dsh-officebench-plugin", factory: (require) => {',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
      footer: `return module.exports; }${stylesheetMeta} });`,
    },
  },
])
