// @ts-check
'use strict';

const path = require('path');
const CopyPlugin = require('copy-webpack-plugin');

/** @type {import('webpack').Configuration} */
const config = {
  target: 'node',
  mode: 'none',
  entry: './src/extension.ts',
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: [
    { vscode: 'commonjs vscode' },
    // Optional peer deps of llm-wrapper — resolved at runtime if installed
    { openai: 'commonjs openai' },
    { '@anthropic-ai/sdk': 'commonjs @anthropic-ai/sdk' },
    { '@google/generative-ai': 'commonjs @google/generative-ai' },
    { '@google-cloud/vertexai': 'commonjs @google-cloud/vertexai' },
    // nut.js has native bindings + heavy deps — resolved at runtime.
    { '@nut-tree-fork/nut-js': 'commonjs @nut-tree-fork/nut-js' },
    // ESM-only @sschepis and @aleph-ai packages are NOT listed here. They are
    // imported via the `dynamicImport()` helper at call sites, which Node.js
    // resolves natively at runtime using native dynamic ESM import.
  ],
  resolve: {
    extensions: ['.ts', '.js', '.cjs'],
    mainFields: ['main', 'module'],
    // Only use `type: 'module'` imports for @sschepis/* (they are ESM-only,
    // but since we use dynamic import() with webpackIgnore, webpack never
    // actually resolves them at build time).
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [{ loader: 'ts-loader', options: { transpileOnly: true } }],
      },
    ],
  },
  ignoreWarnings: [
    // Suppress "Critical dependency: the request of a dependency is an expression"
    // which webpack emits for dynamic imports it can't statically analyze.
    /Critical dependency/,
  ],
  plugins: [
    new CopyPlugin({
      patterns: [
        {
          from: 'node_modules/@sschepis/as-agent/build/release.wasm',
          to: 'release.wasm',
          noErrorOnMissing: true,
        },
      ],
    }),
  ],
  devtool: 'nosources-source-map',
  infrastructureLogging: {
    level: 'log',
  },
};

module.exports = config;
