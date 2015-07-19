var debug = require('debug')('package');
var tmp = require('tmp');
var fs = require('fs');
var path = require('path');
var request = require('request');

// TODO falcon: is it safe to unzip on our end?
exports.fetch = function(uri, cb) {
  tmp.dir(function(err, dirPath, cleanup) {
    if (err) return cb(err);

    var output = path.join(dirPath, 'package.zip');
    request(uri)
      .pipe(fs.createWriteStream(output))
      .on('close', function () {
        debug('Downloaded %s', output);
        cb(null, output);
      });
  });
}
