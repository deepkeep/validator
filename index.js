var debug = require('debug')('index');
var fs = require('fs');
var nconf = require('nconf');
var Docker = require('dockerode');
var DockerEvents = require('docker-events');
var express = require('express');
var uuid = require('uuid');

var app = express();

nconf.env().file('local.json');

var docker = new Docker({
  host: nconf.get('docker:host'),
  port: nconf.get('docker:port'),
  key: fs.readFileSync(nconf.get('docker:key')),
  cert: fs.readFileSync(nconf.get('docker:cert')),
  ca: fs.readFileSync(nconf.get('docker:ca'))
});

function buildImage(git, cb) {
  debug('Building image from %s', git)
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

      debug('Built image for %s %s', git, imageId);
      // TODO falcon: consider fetching the full docker identifier...
      cb(null, imageId);
    });
  });
}

var containerRefuse = {};

function runImage(imageId, cb) {
  // TODO falcon: err handling;
  debug('Building container for %s', imageId);
  docker.createContainer({Image: imageId}, function (err, container) {
    containerRefuse[container.id] = true;
    container.start(function (err) {
      debug('Starting container %s', container.id);
      cb(err, container.id);
    });
  });
}

function extinguishJob(job, cb) {
  var container = docker.getContainer(job.containerId);
  container.remove(function(err) {
    debug('Removing container %s %s', job.containerId, err);
    var image = docker.getImage(job.imageId);
    image.remove(function(err) {
      debug('Removing image %s %s', job.imageId, err);
    });
  });
}

var jobs = {};

app.post('/api/v0/verify', function(req, res, next) {
  var git = req.query.git;
  if (!git) return res.sendStatus(400);

  buildImage(git, function(err, imageId) {
    if (err) return res.sendStatus(500);

    // fire off a container
    runImage(imageId, function(err, containerId) {
      var job = jobs[containerId] = {
        id: uuid.v1(),
        url: '/api/v0/job/' + containerId,
        imageId: imageId,
        containerId: containerId,
        submitted: Date.now(),
        state: 'RUNNING'
      }

      res.status(202).json(job);
    });
  });
});

app.get('/api/v0/job/:id', function(req, res, next) {
  var id = req.params.id;
  var job = jobs[req.params.id];
  if (job) {
    res.json(job);
  } else {
    res.sendStatus(404);
  }
});

var emitter = new DockerEvents({
  docker: docker,
});

emitter.start();

// die is emitted when building an image, so we only clean up containers in the
// containerRefuse object
emitter.on('die', function(message) {
  if (message.id && containerRefuse[message.id]) {
    debug('Container finished executing %s', message.id);
    var container = docker.getContainer(message.id);
    container.logs({stdout: true}, function(err, data) {
      if (err) return console.log(err);

      debug('Processing container logs %s', container.id);
      processContainerLogs(data, function(err, log) {
        var job = jobs[container.id];
        job.result = log;
        job.state = 'FINISHED';

        extinguishJob(job);
      });
    });
  }
});

function processContainerLogs(data, cb) {
  // TODO falcon: just reading into a string for demo purposes...
  var log = '';
  data.on('data', function(chunk) {
    log += chunk.toString();
  });

  data.on('end', function() {
    cb(null, log);
  });
}


var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
