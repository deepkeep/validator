var debug = require('debug')('index');
var fs = require('fs');
var nconf = require('nconf');
var Docker = require('./lib/docker');
var express = require('express');
var uuid = require('uuid');
var request = require('request');

var app = express();

nconf.env().file('local.json');

var docker = new Docker({
  host: nconf.get('docker:host'),
  port: nconf.get('docker:port'),
  key: fs.readFileSync(nconf.get('docker:key')),
  cert: fs.readFileSync(nconf.get('docker:cert')),
  ca: fs.readFileSync(nconf.get('docker:ca'))
});

var jobs = {};

app.use(function requestLogger(req, res, next) {
  console.log(req.method + ' ' + req.url);
  next();
});

app.post('/api/v0/dummyverify', function(req, res, next) {
  res.json({ state: 'RUNNING' });
  setTimeout(function() {
    request({
      uri: req.query.callback,
      method: 'POST',
      json: {
        score: Math.random()
      }
    }, function(err, res) {
      console.log('Dummy callback post done', err, res.statusCode);
    });
  }, 2*1000);
});

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

  docker.buildImage(git, jobId, function(err, imageId) {
    job.imageId = imageId;
    docker.runImage(imageId, jobId, function(err, containerId) {
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

var dockerEmitter = docker.emitter();
dockerEmitter.start();

// die is emitted when building an image, so we only clean up containers used
// for running a job.
dockerEmitter.on('die', function(message) {
  var containerId = message.id;
  docker.getContainerName(containerId, function(err, jobId) {
    var job = jobs[jobId];
    if (!job) return;

    debug('Container finished executing %s for %s', containerId, jobId);
    docker.readContainerLogs(containerId, function(err, log) {
      var job = jobs[jobId];
      job.result = log;
      job.finished = Date.now();
      job.state = 'FINISHED';

      docker.removeContainer(containerId);
    });
  });
});

var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
