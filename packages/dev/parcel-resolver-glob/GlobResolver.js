const {Resolver} = require('@parcel/plugin');
const {isGlob, glob, relativePath, normalizeSeparators} = require('@parcel/utils');
const micromatch = require('micromatch');
const path = require('path');
const nullthrows = require('nullthrows');
const ThrowableDiagnostic = require('@parcel/diagnostic');

module.exports = new Resolver({
  async resolve({dependency, options, filePath, pipeline}) {
    if (!isGlob(filePath)) {
      return;
    }

    // let sourceAssetType = nullthrows(dependency.sourceAssetType);
    let sourceFile = nullthrows(
      dependency.resolveFrom ?? dependency.sourcePath,
    );

    let error;
    // if (sourceAssetType !== 'js' && sourceAssetType !== 'css') {
    //   error = `Glob imports are not supported in ${sourceAssetType} files.`;
    // } else if (dependency.isURL) {
    //   error = 'Glob imports are not supported in URL dependencies.';
    // }

    if (error) {
      throw new ThrowableDiagnostic({
        diagnostic: {
          message: error,
        },
      });
    }

    filePath = path.resolve(path.dirname(sourceFile), filePath);
    let normalized = normalizeSeparators(filePath);
    let files = await glob(normalized, options.inputFS, {
      onlyFiles: true,
    });

    let dir = path.dirname(filePath);
    let results = files.map(file => {
      let relative = relativePath(dir, file);
      if (pipeline) {
        relative = `${pipeline}:${relative}`;
      }

      return [file, relative];
    });

    let code = '';
    // if (sourceAssetType === 'js') {
      let re = micromatch.makeRe(normalized, {capture: true});
      let matches = {};
      for (let [file, relative] of results) {
        let match = file.match(re);
        if (!match) continue;
        let parts = match
          .slice(1)
          .filter(Boolean)
          .reduce((a, p) => a.concat(p.split('/')), []);
        set(matches, parts, relative);
      }

      let {value, imports} = generate(matches, dependency.isAsync);
      code = imports + 'module.exports = ' + value;
      console.log(code)
    // } else if (sourceAssetType === 'css') {
    //   for (let [, relative] of results) {
    //     code += `@import "${relative}";\n`;
    //   }
    // }

    return {
      filePath: path.join(
        dir,
        path.basename(filePath, path.extname(filePath)) + '.js',
      ),
      code,
      // TODO: should be relative to the project root once #5900 lands.
      invalidateOnFileCreate: [{glob: normalized}],
      pipeline: null,
      isAsync: false,
    };
  },
});

function set(obj, path, value) {
  for (let i = 0; i < path.length - 1; i++) {
    let part = path[i];

    if (obj[part] == null) {
      obj[part] = {};
    }

    obj = obj[part];
  }

  obj[path[path.length - 1]] = value;
}

function generate(matches, isAsync, indent = '', count = 0) {
  if (typeof matches === 'string') {
    if (isAsync) {
      return {
        imports: '',
        value: `() => import(${JSON.stringify(matches)})`,
        count
      };
    }

    let key = `_temp${count++}`;
    return {
      imports: `const ${key} = require(${JSON.stringify(matches)});`,
      value: key,
      count
    };
  }

  let imports = '';
  let res = indent + '{';

  let first = true;
  for (let key in matches) {
    if (!first) {
      res += ',';
    }

    let {imports: i, value, count: c} = generate(
      matches[key],
      isAsync,
      indent + '  ',
      count
    );
    imports += `${i}\n`;
    count = c;

    res += `\n${indent}  ${JSON.stringify(key)}: ${value}`;
    first = false;
  }

  res += '\n' + indent + '}';
  return {imports, value: res, count};
}
