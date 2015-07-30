var debug = require('debug')('fetcher');
var tmp = require('tmp');
var fs = require('fs');
var path = require('path');
var request = require('request');
var conf = require('./conf');

exports.fetch = function(uri) {
  return new Promise(function(resolve, reject) {
    var opts = {
      prefix: 'deepkeep',
      dir: conf.get('tmp'),
      unsafeCleanup: true
    }
    tmp.dir(opts, function(err, dirPath, cleanup) {
      if (err) return reject(err);

      var output = path.resolve(path.join(dirPath, 'package.zip'));
      debug('Downloading %s', uri);
      request(uri)
        .on('error', reject)
        .pipe(fs.createWriteStream(output))
        .on('close', function () {
          debug('Downloaded %s', output);
          resolve({ packagePath: output, cleanup: cleanup });
        });
    });
  });
}
