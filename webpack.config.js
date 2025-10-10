/** @format */

// Copyright 2025 ali.falahi@ermetic.com
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     https://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

const path = require('path');

// Configuration for the language client (VS Code extension)
const clientConfig = {
  target: 'node',
  mode: 'production',
  entry: './src/client/extension.ts',
  output: {
    path: path.resolve(__dirname, 'out', 'client'),
    filename: 'extension.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
};

// Configuration for the language server
const serverConfig = {
  target: 'node',
  mode: 'production',
  entry: './src/server/server.ts',
  output: {
    path: path.resolve(__dirname, 'out', 'server'),
    filename: 'server.js',
    libraryTarget: 'commonjs2',
  },
  externals: {
    vscode: 'commonjs vscode',
  },
  resolve: {
    extensions: ['.ts', '.js'],
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: 'ts-loader',
          },
        ],
      },
    ],
  },
  // Optimization to reduce bundle size
  optimization: {
    minimize: true,
  },
};

module.exports = [clientConfig, serverConfig];
