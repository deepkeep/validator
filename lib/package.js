var debug = require('debug')('package');
var temp = require('temp');
var fs = require('fs');
var path = require('path');
var request = require('request');

temp.track();

// need this to download the image and the project to verify.

temp.mkdir('somejobid', function(err, dirPath) {
  var output = path.join(dirPath, 'package.zip');

  request(sompackageuri)
    .pipe(fs.createWriteStream(output))
    .on('close', function () {
      debug('Downloaded package.zip');
      // some callback...callback should clean up temp directory.
    });
});
