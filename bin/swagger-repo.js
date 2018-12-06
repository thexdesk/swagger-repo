#!/usr/bin/env node
'use strict'

var fs = require('fs-extra')
var path = require('path')
var _ = require('lodash')
var program = require('commander')
var express = require('express')
var cors = require('cors')
var chalk = require('chalk')
var ghpages = require('gh-pages')

var { execSync } = require('child_process')

var api = require('../')
var liveReload = require('../lib/livereload')

function writeAndLog(filename, contents) {
  fs.writeFileSync(filename, contents);
  console.log(`Created ${chalk.blue(filename)}`)
}

program.command('bundle')
  .description('Bundles a multi-file Swagger spec')
  .option('-b, --basedir <relpath>', 'The output file')
  .option('-o, --outfile <filename>', 'The output file')
  .option('-y, --yaml', 'Output YAML(Default is JSON)')
  .action(function (options) {
    var swagger = api.bundle({...options, verbose: true})
    var str = api.stringify(swagger, options)

    if (options.outfile) {
      fs.writeFileSync(options.outfile, str)
      console.log('Created "%s" swagger file.', options.outfile)
    } else {
      // Write the bundled spec to stdout
      console.log(str)
    }
  })

program.command('build')
  .description('Builds the static assets and puts it ')
  .option('-b, --basedir <relpath>', 'The output file')
  .option('-o, --outdir <dirname>', 'The output directory, web_deploy by default')
  .action(function (options) {
    var swagger = api.bundle({...options, verbose: true})
    var json = api.stringify(swagger)
    var yaml = api.stringify(swagger, {yaml: true})
    var html = api.compileIndexPage()

    var outDir = options.outdir || 'web_deploy';
    fs.removeSync(outDir);
    fs.mkdirpSync(outDir);
    fs.copySync('web/', outDir, {
      filter: filename => filename !== 'redoc-config.yaml'
    });
    console.log(`Copied ${chalk.blue('/web')} to ${chalk.blue(outDir)}`)
    writeAndLog(path.join(outDir, 'openapi.json'), json);
    writeAndLog(path.join(outDir, 'openapi.yaml'), yaml);
    writeAndLog(path.join(outDir, 'index.html'), html)
  })

  program.command('gh-pages')
  .description('Deploys to the gh-pages branch')
  .option('-c, --clean', 'Do not preserve existing files (will remove previews)')
  .option('-p, --preview <name>', 'Deploy as preview')
  .action(function (options) {
    console.log('Deploying... It may take a few minutes');
    fs.removeSync(path.join(require.resolve('gh-pages'), '../../.cache'));

    let publishOpts = {
      add: !!options.clean, 
      push: false,
    }

    if (options.preview) {
      publishOpts.dest = 'preview/' + options.preview;
    }

    if (process.env.TRAVIS) {
      if (!process.env.GH_TOKEN) {
        console.log('You have to set GH_TOKEN environment variable when deploying from Travis CI');
        process.exit(1);
      }

      publishOpts = {
        ...publishOpts, 
        silent: true,
        message: 'Deployed to Github Pages',
        user: 'Travis-CI',
        email: 'travis@travis',
        repo: 'https://' + process.env.GH_TOKEN + '@github.com/' + process.env.TRAVIS_REPO_SLUG + '.git'
      }
    }

    ghpages.publish('web_deploy', publishOpts, function(err) {
      if (err) {
        console.log(chalk.red('Deploy failed: ') + err);
      }
      console.log(chalk.green('🎉  Deployed uccessfully!'));
      if (options.preview && process.env.TRAVIS_BRANCH) {
        notifyBranchPreviewFromTravis(process.env.TRAVIS_BRANCH);
      }
    })
  })

function notifyBranchPreviewFromTravis(branch) {
  try {
    const [owner, repo] = process.env.TRAVIS_REPO_SLUG.split('/');
    const url = `http://${owner}.github.io/${repo}/preview/${branch}/`;
    execSync(`github-status-reporter --user ${owner} --repo ${repo} --branch ${branch} --state success --target-url="${url}" --description="Link to preview" --context "Preview"`, {
      GITHUB_TOKEN: process.env.GH_TOKEN,
      stdio: 'inherit'
    });
    console.log('Set branch status on GitHub')
  } catch(e) {
    console.log('Failed to update branch status on GitHub')
  }
}

program.command('sync-with-swagger')
  .description('Sync single-file Swagger spec with bundle')
  .option('-b, --basedir <relpath>', 'The output file')
  .arguments('<swagger>')
  .action(function (swagger, options) {
    api.syncWithSwagger(fs.readFileSync(swagger, 'utf-8'), options)
  })

program.command('validate')
  .description('Validate Swagger file')
  .option('-b, --basedir <relpath>', 'The output file')
  .action(function (options) {
    var swagger = api.bundle(options)
    api.validate(swagger, function (error, result) {
      var isErrors = !_.isEmpty(result.errors)
      var isWarnings = !_.isEmpty(result.warnings)

      if (isErrors) {
        console.error('Validation errors:\n' +
            JSON.stringify(result.errors, null, 2))
        process.exitCode = 255
      }

      if (error) {
        console.error('Validation error:\n' +
            JSON.stringify(error.message, null, 2))
        process.exitCode = 255
      }

      if (isWarnings) {
        // FIXME: 'discrimanator' doesn't handle properly by sway so ignore warnings
        console.error('Validation warnings:\n' +
            JSON.stringify(result.warnings, null, 2))
      }
    })
  })

program.command('serve')
  .description('Serves a Swagger and some tools via the built-in HTTP server')
  .option('-p, --port <port>', 'The server port number')
  .option('-b, --basedir <relpath>', 'The output file')
  .action(function (options) {
    var app = express()
    app.use(cors())

    app.get('/', api.indexMiddleware)
    app.use('/', api.swaggerFileMiddleware(options))
    app.use('/swagger-ui', api.swaggerUiMiddleware(options))

    app.use('/swagger-editor', api.swaggerEditorMiddleware(options))

    // Error handler
    app.use(function (err, req, res, next) {
      console.error(err.stack)
      res.status(500).json({ 'error': err.message })
      next(err)
    })

    // Run server
    const port = options.port || 8080
    app.listen(port)

    liveReload.startLiveReload(options);

    const baseUrl = 'http://localhost:' + port;

    console.log('\nDevelopment server started 🎉 :\n')
    console.log(`  ${chalk.green('✔')} Documentation (ReDoc):\t${chalk.blue(chalk.underline(baseUrl))}`)
    console.log(`  ${chalk.green('✔')} Swagger Editor: \t\t${chalk.blue(chalk.underline(baseUrl + '/swagger-editor'))}`);
    console.log();
    console.log('Watching changes...');
  })

program
  .version(require('../package').version)
  .parse(process.argv)

// Show help if no options were given
if (program.rawArgs.length < 3) {
  program.help()
}
