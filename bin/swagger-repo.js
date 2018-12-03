#!/usr/bin/env node
'use strict'

var fs = require('fs')

var _ = require('lodash')
var program = require('commander')
var express = require('express')
var cors = require('cors')
var livereload = require('livereload')

const LIVERELOAD_SCRIPT = `
<script>
document.write('<script src="http://' + (location.host || 'localhost').split(':')[0] +
':35729/livereload.js?snipver=1"></' + 'script>')
</script>
`

var api = require('../')

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

    app.get('/', (_, res) => {
      // inject Live Reload
      const fileContents = fs.readFileSync('web/index.html', 'utf-8')
      res.send(fileContents.replace(/<\/body>/, LIVERELOAD_SCRIPT + '</body>'))
      res.end()
    })

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
    app.listen(options.port || 8080)

    var lrserver = livereload.createServer({
      exts: [ 'html', 'css', 'js', 'png', 'gif', 'jpg', 'ico', 'yaml', 'yml', 'json' ]
    })

    lrserver.watch([
      'web',
      options.basedir || 'spec'
    ])
  })

program
  .version(require('../package').version)
  .parse(process.argv)

// Show help if no options were given
if (program.rawArgs.length < 3) {
  program.help()
}
