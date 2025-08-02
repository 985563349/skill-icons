import fs from 'node:fs/promises';
import path from 'node:path';
import { parseArgs } from 'node:util';
import camelcase from 'camelcase';
import svgr from '@svgr/core';
import swc from '@swc/core';
import compiler from '@vue/compiler-dom';

const { positionals } = parseArgs({ allowPositionals: true });

const transforms = {
  react: async (options) => {
    const { svg, componentName, format } = options;

    const component = await svgr.transform(
      svg,
      { icon: true, ref: true, titleProp: true, plugins: ['@svgr/plugin-jsx'], expandProps: 'end' },
      { componentName }
    );

    const { code } = await swc.transform(component, {
      jsc: {
        parser: { jsx: true },
        target: 'es2022',
      },
      module: {
        type: format === 'esm' ? 'es6' : 'commonjs',
        noInterop: true,
      },
    });

    if (format === 'cjs') {
      return code
        .replace(/Object\.defineProperty\(exports,\s*["']default["'],\s*\{[\s\S]*?\}\);?\s*/g, '')
        .replace(/const\s+_default\s*=\s*([^;]+);?\s*$/m, 'module.exports = $1;');
    }

    return code;
  },

  vue: (options) => {
    const { svg, format } = options;

    const { code } = compiler.compile(
      svg
        .replace(/<svg([^>]*)\s+width="[^"]*"([^>]*)>/g, '<svg$1 width="1em"$2>')
        .replace(/<svg([^>]*)\s+height="[^"]*"([^>]*)>/g, '<svg$1 height="1em"$2>'),
      { mode: 'module' }
    );

    if (format === 'cjs') {
      return code
        .replace(
          /import\s+\{\s*([^}]+)\s*\}\s+from\s+(['"])(.*?)\2/,
          (_match, imports, _quote, mod) => {
            let newImports = imports
              .split(',')
              .map((i) => i.trim().replace(/\s+as\s+/, ': '))
              .join(', ');

            return `const { ${newImports} } = require("${mod}")`;
          }
        )
        .replace('export function render', 'module.exports = function render');
    }

    return code.replace('export function', 'export default function');
  },
};

async function build(target, format) {
  let output = `./packages/${target}/${format}`;

  const icons = await getIcons();

  await Promise.all(
    icons.flatMap(async ({ svg, componentName }) => {
      const content = await transforms[target]({ svg, componentName, format });

      /** @type {string[]} */
      const types = [];

      if (target === 'react') {
        types.push(`import * as React from 'react';`);
        types.push(
          `declare const ${componentName}: React.ForwardRefExoticComponent<React.PropsWithoutRef<React.SVGProps<SVGSVGElement>> & { title?: string, titleId?: string } & React.RefAttributes<SVGSVGElement>>;`
        );
        types.push(`export default ${componentName};`);
      } else if (target === 'vue') {
        types.push(`import type { FunctionalComponent, HTMLAttributes, VNodeProps } from 'vue';`);
        types.push(
          `declare const ${componentName}: FunctionalComponent<HTMLAttributes & VNodeProps>;`
        );
        types.push(`export default ${componentName};`);
      }

      return [
        ensureWrite(`${output}/${componentName}.js`, content),
        ...[ensureWrite(`${output}/${componentName}.d.ts`, types.join('\n') + '\n')],
      ];
    })
  );

  await ensureWrite(`${output}/index.js`, exportAll(icons, format));
  await ensureWrite(`${output}/index.d.ts`, exportAll(icons, 'esm'));
}

async function ensureWrite(file, text) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, text, 'utf8');
}

async function getIcons() {
  const entry = './assets';
  const files = await fs.readdir(entry);

  return Promise.all(
    files.map(async (file) => ({
      svg: await fs.readFile(`./${entry}/${file}`, 'utf-8'),
      componentName: camelcase(file.replace(/\.svg$/, ''), { pascalCase: true }),
    }))
  );
}

function exportAll(icons, format) {
  return icons
    .map(({ componentName }) => {
      if (format === 'esm') {
        return `export { default as ${componentName} } from './${componentName}'`;
      }
      return `module.exports.${componentName} = require('./${componentName}')`;
    })
    .join('\n');
}

async function main() {
  try {
    const target = positionals[0];

    console.log(`Building ${target} package...`);

    await Promise.all([build(target, 'esm'), build(target, 'cjs')]);

    console.log(`Finished building ${target} package.`);
  } catch (error) {
    console.error(error);
  }
}

main();
