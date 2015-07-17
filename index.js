var debug = require('debug')('index');
var fs = require('fs');
var nconf = require('nconf');
var Docker = require('dockerode');
var DockerEvents = require('docker-events');
var express = require('express');
var uuid = require('uuid');
var streamToArray = require('stream-to-array');

var app = express();

nconf.env().file('local.json');

var docker = new Docker({
  host: nconf.get('docker:host'),
  port: nconf.get('docker:port'),
  key: fs.readFileSync(nconf.get('docker:key')),
  cert: fs.readFileSync(nconf.get('docker:cert')),
  ca: fs.readFileSync(nconf.get('docker:ca'))
});

function buildImage(git, jobId, cb) {
  debug('Building image from %s for %s', git, jobId)
  docker.buildImage('', {remote: git, q: true, t: jobId}, function (err, response) {
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

      docker.getImage(imageId).inspect(function(err, data) {
        if (err) return cb(err);
        debug('Built image for %s %s', git, data.Id);
        cb(null, data.Id);
      });
    });
  });
}

var containerRefuse = {};

function runImage(imageId, jobId, cb) {
  // TODO falcon: err handling;
  // TODO falcon: lots and lots of options here
  // TODO falcon: https://docs.docker.com/reference/api/docker_remote_api_v1.19/#create-a-container
  debug('Building container from %s for %s', imageId, jobId);
  docker.createContainer({Image: imageId, NetworkDisabled: true, name: jobId}, function (err, container) {
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

function readContainerLogs(containerId, cb) {
  debug('Reading container logs %s', containerId);
  var container = docker.getContainer(containerId);
  container.logs({stdout: true}, function(err, data) {
    if (err) return cb(err);
    streamToArray(data, function(err, arr) {
      cb(null, Buffer.concat(arr).toString());
    });
  });
}

function containerIdToJobId(containerId, cb) {
  docker.getContainer(containerId).inspect(function(err, data) {
    if (err) return cb(err);
    // name of container starts with '/'
    return cb(null, data.Name.substring(1));
  });
}

var jobs = {};

app.post('/api/v0/verify', function(req, res, next) {
  var git = req.query.git;
  if (!git) return res.sendStatus(400);

  var jobId = uuid.v1();
  var job = jobs[jobId] = {
    id: jobId,
    url: '/api/v0/job/' + jobId,
    state: 'SUBMITTED',
    submitted: Date.now(),
  };

  // respond asap.
  res.status(202).json(job);

  buildImage(git, jobId, function(err, imageId) {
    job.imageId = imageId;
    runImage(imageId, jobId, function(err, containerId) {
      job.containerId = containerId;
      job.state = 'RUNNING';
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
  var containerId = message.id;
  if (containerId && containerRefuse[containerId]) {
    containerIdToJobId(containerId, function(err, jobId) {
      debug('Container finished executing %s for %s', containerId, jobId);

      readContainerLogs(containerId, function(err, log) {
        var job = jobs[jobId];
        job.result = log;
        job.finished = Date.now();
        job.state = 'FINISHED';

        extinguishJob(job);
      });
    });
  }
});

var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
