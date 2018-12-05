var livereload = require('livereload')
var chalk = require('chalk')
var express = require('express')
var fs = require('fs')

const LIVERELOAD_SCRIPT = `
<script>
document.write('<script src="http://' + (location.host || 'localhost').split(':')[0] +
':35729/livereload.js?snipver=1"></' + 'script>')
</script>
`

exports.startLiveReload = function(options = {}) {
  var lrserver = livereload.createServer({
    exts: [ 'html', 'css', 'js', 'png', 'gif', 'jpg', 'ico', 'yaml', 'yml', 'json' ],
  })

  lrserver.watch([
    'web',
    options.basedir || 'spec'
  ])

  // monkey-patch Live-Reload refresh to log update events
  const origRefresh = lrserver.__proto__.refresh;
  lrserver.__proto__.refresh = function(filePath) {
    console.log('Updated ' + chalk.blue(filePath) + ' refreshing');
    origRefresh.call(this, filePath);
  }
}

exports.injectLiveReloadingMiddleware = function(req, res) {
    const fileContents = fs.readFileSync('web/index.html', 'utf-8')
    res.send(fileContents.replace(/<\/body>/, LIVERELOAD_SCRIPT + '</body>'))
    res.end()
}
