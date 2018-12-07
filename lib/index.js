'use strict';

const fs = require('fs');
const Path = require('path');

const _ = require('lodash');
const YAML = require('js-yaml');
const glob = require('glob').sync;
const sway = require('sway');
const chalk = require('chalk');
const mkdirp = require('mkdirp').sync;
const requireDir = require('require-dir');

const jpath = require('jsonpath');
const jsonpointer = require('json-pointer');

const express = require('express');
const bodyParser = require('body-parser');

const livereload = require('./livereload');

const anyYaml = '**/*.yaml';

function calcPaths(basedir = 'spec/') {
  return {
    mainFile: basedir + 'swagger.yaml',
    pathsDir: basedir + 'paths/',
    definitionsDir: basedir + 'definitions/',
    codeSamplesDir: basedir + 'code_samples/'
  };
}

exports.readConfig = function() {
  let config = {};
  try {
    config = YAML.safeLoad(fs.readFileSync('.redoclyrc', 'utf-8', { json: true }));
  } catch(e) {
    console.warn(`Redocly config not found at ${chalk.yellow('.redoclyrc')}. Using empty...`);
  }
  return config;
}

exports.compileIndexPage = function(options = {}) {
  const fileContents = fs.readFileSync('web/index.html', 'utf-8');
  let redocConfig = {};

  try {
    redocConfig = YAML.safeLoad(fs.readFileSync('web/redoc-config.yaml', 'utf-8', { json: true }));
  } catch (e) {
    // skip
    console.warn(`ReDoc config not found in ${chalk.yellow('web/redoc-config.yaml')}. Skipping...`);
  }

  return fileContents
    .replace('{{redocHead}}', options.livereload ? livereload.LIVERELOAD_SCRIPT : '')
    .replace(
      '{{redocBody}}',
      `<div id="redoc_container"></div>
    <script src="https://cdn.jsdelivr.net/npm/redoc/bundles/redoc.standalone.js"></script>
    <script>
      Redoc.init(
        './openapi.json',
        ${JSON.stringify(redocConfig)},
        document.getElementById("redoc_container")
      );
    </script>`
    );
};

exports.indexMiddleware = function(req, res) {
  res.end(exports.compileIndexPage({ livereload: true }));
};

exports.swaggerEditorMiddleware = function(options = {}) {
  const router = express.Router();

  const { mainFile } = calcPaths(options.basedir);

  // router.use('/config/defaults.json', express.static(require.resolve('./editor_config.json')))
  router.get('/', (req, res) => {
    const bundled = exports.bundle({
      skipCodeSamples: true,
      skipHeadersInlining: true,
      skipPlugins: true,
      basedir: options.basedir
    });

    let spec;
    if (_.isEqual(bundled, readYaml(mainFile))) {
      spec = fs.readFileSync(mainFile, 'utf-8');
    } else {
      spec =
        '' +
        '# Note: This spec is defined in multiple files.\n' +
        '# All comments and formating were lost during the bundle process.\n' +
        '# Existing files formatting may be not preserved on save.\n' +
        exports.stringify(bundled, { yaml: true });
    }

    const fileContents = fs.readFileSync(Path.join(__dirname, 'editor.html'), 'utf-8');
    res.send(fileContents.replace('<%SPEC_CONTENTS%>', JSON.stringify(spec)));
    res.end();
  });

  router.use('/', express.static(Path.dirname(require.resolve('swagger-editor-dist/index.html'))));

  router.use(
    bodyParser.text({
      type: 'application/yaml',
      limit: '10mb' // default limit was '100kb' which is too small for many specs
    })
  );

  router.put('/backend_swagger.yaml', function(req, res) {
    try {
      exports.syncWithSwagger(req.body, options);
    } catch (e) {
      console.log(chalk.red('Error while synchronizing spec from Swagger Editor: ' + e.message));
    }
    res.end('ok');
    // TODO: error handling
  });

  return router;
};

exports.getPatchedSwaggerUIIndex = function() {
  const orig = fs.readFileSync(require.resolve('swagger-ui-dist/index.html'), 'utf-8');
  return orig.replace('https://petstore.swagger.io/v2/swagger.json', '../openapi.json');
}

exports.swaggerUiMiddleware = function() {
  const router = express.Router();
  router.get('/', function (req, res) {
    res.end(exports.getPatchedSwaggerUIIndex());
  });
  router.use('/', express.static(Path.dirname(require.resolve('swagger-ui-dist'))));
  return router;
};

exports.swaggerFileMiddleware = function(options = {}) {
  const router = express.Router();

  router.get('/openapi.json', function(req, res) {
    res.setHeader('Content-Type', 'application/json');
    try {
      res.end(exports.stringify(exports.bundle(options), { json: true }));
    } catch (e) {
      console.log(chalk.red('Error while bundling the spec: ' + e.message));
      res.end(JSON.stringify({ error: e.message }));
    }
  });

  router.get('/openapi.yaml', function(req, res) {
    res.setHeader('Content-Type', 'application/yaml');
    res.end(exports.stringify(exports.bundle(options), { yaml: true }));
  });

  router.use(express.static('web'));
  return router;
};

exports.syncWithSwagger = function(swagger, options = {}) {
  const { pathsDir, definitionsDir, mainFile } = calcPaths(options.basedir);

  if (_.isString(swagger)) {
    if (!dirExist(pathsDir) && !dirExist(definitionsDir)) {
      mkdirp(Path.dirname(mainFile));
      return fs.writeFileSync(mainFile, swagger);
    }
    swagger = exports.parse(swagger);
  }
  // FIXME: support x-code-samples
  // FIXME: support for headers

  if (swagger.paths && dirExist(pathsDir)) {
    const paths = _.mapKeys(swagger.paths, function(value, key) {
      return key.substring(1).replace(/\//g, '@');
    });
    updateGlobObject(pathsDir, paths);
    swagger = _.omit(swagger, 'paths');
  }

  if (swagger.definitions && dirExist(definitionsDir)) {
    updateGlobObject(definitionsDir, swagger.definitions);
    swagger = _.omit(swagger, 'definitions');
  }

  updateYaml(mainFile, swagger);
};

exports.bundle = function(options = {}) {
  const { pathsDir, definitionsDir, mainFile, codeSamplesDir } = calcPaths(options.basedir);
  const swagger = readYaml(mainFile);

  if (dirExist(pathsDir)) {
    if (options.verbose) {
      console.log('[spec] Adding paths to spec');
    }
    if (swagger.paths) {
      throw Error('All paths should be defined inside ' + pathsDir);
    }
    swagger.paths = globYamlObject(pathsDir, _.flow([baseName, filenameToPath]));
  }

  if (dirExist(definitionsDir)) {
    if (options.verbose) {
      console.log('[spec] Adding definitions to spec');
    }
    if (swagger.definitions) {
      throw Error('All definitions should be defined inside ' + definitionsDir);
    }
    swagger.definitions = globYamlObject(definitionsDir, baseName);
  }

  if (!options.skipCodeSamples && dirExist(codeSamplesDir)) {
    if (options.verbose) {
      console.log('[spec] Adding code samples to spec');
    }
    bundleCodeSample(swagger, codeSamplesDir);
  }

  if (!options.skipHeadersInlining && swagger.headers) {
    if (options.verbose) {
      console.log('[spec] Inlining headers referencess');
    }
    inlineHeaders(swagger);
  }

  if (!options.skipPlugins) {
    runPlugins(swagger, options);
  }

  return swagger;
};

function dirExist(path) {
  try {
    return fs.statSync(path).isDirectory();
  } catch (err) {
    if (err && err.code === 'ENOENT') {
      return false;
    }
    throw err;
  }
}

function runPlugins(swagger) {
  const relativePluginsDir = process.env.SWAGERREPO_PLUGINS_DIR || 'spec/plugins';
  const pluginsDir = Path.join(process.cwd(), relativePluginsDir);
  let plugins;

  if (!fs.existsSync(pluginsDir)) {
    return;
  }

  console.log('[spec] Running plugins');
  plugins = requireDir(pluginsDir);

  plugins = _.values(plugins);

  _.each(plugins, function(plugin) {
    plugin.init && plugin.init(swagger);
    _.each(jpath.nodes(swagger, plugin.pathExpression), function(node) {
      const name = _.last(node.path);
      const parent = jpath.value(swagger, jpath.stringify(_.dropRight(node.path)));
      plugin.process(parent, name, node.path, swagger);
    });
    plugin.finish && plugin.finish(swagger);
  });
}

function bundleCodeSample(swagger, codeSamplesDir) {
  const codeSamples = globObject(codeSamplesDir, '*/*/*', function(filename) {
    // path === '<language>/<path>/<verb>'
    const dirs = Path.dirname(filename);
    const lang = Path.dirname(dirs);
    const path = Path.basename(dirs);
    // [<path>, <verb>, <language>]
    return [filenameToPath(path), baseName(filename), lang];
  });

  _.each(codeSamples, function(pathSamples, path) {
    _.each(pathSamples, function(opSamples, verb) {
      const swaggerOperation = _.get(swagger.paths, [path, verb]);
      if (_.isUndefined(swaggerOperation)) {
        throw Error('Code sample for non-existing operation: "' + path + '",' + verb);
      }

      if (_.has(swaggerOperation, 'x-code-samples')) {
        throw Error('All code samples should be defined inside ' + codeSamplesDir);
      }

      swaggerOperation['x-code-samples'] = _.map(opSamples, function(path, lang) {
        return { lang: lang, source: fs.readFileSync(path, 'utf-8') };
      });
    });
  });
}

exports.stringify = function(swagger, options = {}) {
  if (options.yaml) {
    return YAML.safeDump(swagger, { indent: 2, lineWidth: -1, noRefs: true });
  }

  return JSON.stringify(swagger, null, 2) + '\n';
};

exports.parse = function(string) {
  try {
    return JSON.parse(string);
  } catch (jsonError) {
    try {
      return YAML.safeLoad(string, { json: true });
    } catch (yamlError) {
      // TODO: better error message
      throw new Error('Can not parse Swagger both in YAML and JSON');
    }
  }
};

exports.validate = function(swagger, cb) {
  sway.create({ definition: swagger }).then(
    function(swaggerObj) {
      return cb(null, swaggerObj.validate());
    },
    function(error) {
      cb(error);
    }
  );
};

function inlineHeaders(swagger) {
  jpath.apply(swagger, '$..[?(@.$ref)]', function(value) {
    if (!value.$ref.startsWith('#/headers')) {
      return value;
    }

    // TODO: throw if (!_.omit(value, '$ref').isEmpty())
    return jsonpointer.get(swagger, value.$ref.substring(1));
  });
  delete swagger.headers;
}

function baseName(path) {
  return Path.parse(path).name;
}

function filenameToPath(filename) {
  return '/' + filename.replace(/@/g, '/');
}

function globObject(dir, pattern, objectPathCb) {
  return _.reduce(
    glob(dir + pattern),
    function(result, path) {
      const objPath = objectPathCb(path.substring(dir.length));
      if (_.has(result, objPath)) {
        throw new Error(objPath + ' definition already exists');
      }
      _.set(result, objPath, path);

      return result;
    },
    {}
  );
}

function globYamlObject(dir, objectPathCb) {
  return _.mapValues(globObject(dir, anyYaml, objectPathCb), readYaml);
}

function updateGlobObject(dir, object) {
  const knownKeys = globObject(dir, anyYaml, baseName);

  _.each(object, function(value, key) {
    let filename = Path.join(dir, key + '.yaml');
    if (key in knownKeys) {
      filename = knownKeys[key];
      delete knownKeys[key];
    }
    updateYaml(filename, value);
  });

  _(knownKeys)
    .values()
    .each(fs.unlinkSync);
}

function updateYaml(file, newData) {
  let currentData;
  try {
    currentData = readYaml(file);
  } catch (e) {
    // nope
  }

  if (!_.isEqual(newData, currentData)) {
    saveYaml(file, newData);
  }
}

function readYaml(file) {
  return YAML.safeLoad(fs.readFileSync(file, 'utf-8'));
}

function saveYaml(file, object) {
  mkdirp(Path.dirname(file));
  return fs.writeFileSync(file, YAML.safeDump(object, { noRefs: true }));
}
