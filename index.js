var fs = require('fs');
var nconf = require('nconf');
var Docker = require('dockerode');
var DockerEvents = require('docker-events');
var express = require('express');

var app = express();

nconf.env().file('local.json');

var docker = new Docker({
  host: nconf.get('docker:host'),
  port: nconf.get('docker:port'),
  key: fs.readFileSync(nconf.get('docker:key')),
  cert: fs.readFileSync(nconf.get('docker:cert')),
  ca: fs.readFileSync(nconf.get('docker:ca'))
});

app.get('/api/v0/verify', function(req, res, next) {
  docker.createContainer({Image: 'busybox', Cmd: ['/bin/ls']}, function (err, container) {
    container.start(function (err, data) {
      console.log('started container');
      res.sendStatus(201);
    });
  });
});

var emitter = new DockerEvents({
  docker: docker,
});

emitter.start();

emitter.on("die", function(message) {
  var container = docker.getContainer(message.id);
  container.logs({stdout: true}, function(err, data) {
    if (err) return console.log(err);
    data.pipe(process.stdout);
    container.remove(function(err, data) {
      console.log('removed container', err, data);
    });
  })
});

var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
