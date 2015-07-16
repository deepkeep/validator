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

// TODO falcon: this will need to be cleaned up
function buildImage(git, cb) {
  docker.buildImage('', {remote: git, q: true}, function (err, response) {
    if (err) return cb(err);

    docker.modem.followProgress(response, function(err, output) {
      if (err) return cb(err);

      // TODO falcon: there must be a nicer way to do this...
      var imageId;
      for (var i = output.length - 1; i >= 0; i--) {
        var o = output[i];
        if (o && o.stream) {
          var match = o.stream.match('^Successfully built ([0-9a-f]+)\n$');
          if (match) {
            imageId = match[1];
            break;
          }
        }
      }
      cb(null, imageId);
    });
  });
}

var containerRefuse = {};

function runImage(image, cb) {
  // TODO falcon: cmd must be here for some reason...
  // TODO falcon: err handling;
  docker.createContainer({Image: image, Cmd: ['npm', 'test']}, function (err, container) {
    containerRefuse[container.id] = true;
    container.start(function (err) {
      console.log('started a container', container.id, err);
    });
  });
}

app.post('/api/v0/verify', function(req, res, next) {
  var git = req.query.git;
  if (!git) return res.sendStatus(400);

  buildImage(git, function(err, imageId) {
    if (err) return res.sendStatus(500);

    // accept the request as soon as possible...
    res.sendStatus(202);

    // fire off a container
    runImage(imageId);
  });
});

var emitter = new DockerEvents({
  docker: docker,
});

emitter.start();

// die is emitted when building an image, so we only clean up containers in the
// containerRefuse object
emitter.on('die', function(message) {
  if (message.id && containerRefuse[message.id]) {
    var container = docker.getContainer(message.id);
    container.logs({stdout: true}, function(err, data) {
      if (err) return console.log(err);
      data.pipe(process.stdout);
      container.remove(function(err) {
        console.log('removed container', err);
      });
    });
  }
});

var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
