const path = require('path');

const _ = require('lodash');
const chalk = require('chalk');
const { getAllYamls, pathToFilename, dirExist } = require('./utils');

module.exports = function(errors, paths) {
  // clean up oneOf with $ref errors
  for (const error of errors) {
    if (
      error.keyword === 'oneOf' &&
      error.schema.find(sub => sub.$ref == '#/definitions/Reference')
    ) {
      const correspondingRefError = errors.find(err => {
        return (
          err.dataPath === error.dataPath &&
          err.keyword === 'required' &&
          err.params.missingProperty === '$ref'
        );
      });

      if (correspondingRefError) {
        correspondingRefError.skip = true;
        error.skip = true;
      }
    }
  }

  const allPaths = dirExist(paths.pathsDir) && getAllYamls(paths.pathsDir);
  const allComps = {};

  errors = _(errors)
    .filter(err => !err.skip)
    .each(err => {
      if (allPaths && /^\/paths\/[^/]+/.test(err.dataPath)) {
        const [, , specPath, ...rest] = err.dataPath.split('/');
        err.filePath = allPaths[pathToFilename(specPath) + '.yaml'];
        err.dataPath = rest.join('/');
        return;
      }
      if (/^\/components\/[^/]+\/[^/]+/.test(err.dataPath)) {
        const [, , componentType, component, ...rest] = err.dataPath.split('/');
        if (!allComps[componentType]) {
          allComps[componentType] =
            dirExist(path.join(paths.componentsDir, componentType)) &&
            getAllYamls(path.join(paths.componentsDir, componentType));
        }
        if (allComps[componentType]) {
          err.filePath = allComps[componentType][component + '.yaml'];
          err.dataPath = rest.join('/');
          return;
        }
      }
      err.filePath = paths.mainFile;
      err.dataPath = err.dataPath.substring(1);
    });

  const grouppedErrors = _.groupBy(errors, 'filePath');
  let errorNumber = 0;
  for (const filename of Object.keys(grouppedErrors)) {
    console.log(`${chalk.blue(filename)}:`);
    for (const error of grouppedErrors[filename]) {
      let message = `${chalk.bold('#/' + error.dataPath)} ${error.message}`;
      switch (error.keyword) {
        case 'additionalProperties':
          message += ` '${chalk.bold(error.params.additionalProperty)}'`;
          break;
        case 'propertyNames':
          message += ` '${chalk.bold(error.params.propertyName)}'`;
          break;
        case 'enum':
          message += ': ' + chalk.bold(error.params.allowedValues.join(', '));
          break;
        case 'type':
          message += ' but got ' + chalk.bold(error.data === null ? 'null' : typeof error.data);
          break;
      }
      console.log(chalk.red(`  ${++errorNumber}) ${message}`));
    }
    console.log();
  }
};
