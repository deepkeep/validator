var debug = require('debug')('fetcher');
var tmp = require('tmp');
var fs = require('fs');
var path = require('path');
var request = require('request');

exports.fetch = function(uri, cb) {
  tmp.dir({ mode: 0755, prefix: 'deepkeep' }, function(err, dirPath) {
    if (err) return cb(err);

    var output = path.join(dirPath, 'package.zip');
    request(uri)
      .on('error', cb)
      .pipe(fs.createWriteStream(output))
      .on('close', function () {
        debug('Downloaded %s', output);
        cb(null, output);
      });
  });
}
