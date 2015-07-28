var debug = require('debug')('fetcher');
var tmp = require('tmp');
var fs = require('fs');
var path = require('path');
var request = require('request');
var conf = require('./conf');

exports.fetch = function(uri, cb) {
  tmp.dir({ prefix: 'deepkeep', dir: conf.get('tmp') }, function(err, dirPath) {
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
