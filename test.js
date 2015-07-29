var Validation = require('./lib/validation');
var Dockerode = require('dockerode-promise');
var fs = require('fs');
var conf = require('./lib/conf');

var docker = new Dockerode({
  host: conf.get('docker:host'),
  port: conf.get('docker:port'),
  key: fs.readFileSync(conf.get('docker:key')),
  cert: fs.readFileSync(conf.get('docker:cert')),
  ca: fs.readFileSync(conf.get('docker:ca'))
});


var v = new Validation(docker, '/Users/falcon/Code/mahler/tmp/package.zip');
v.run('docker.deepkeep.co/falcon/tape-test:latest');
