var debug = require('debug')('index');
var fs = require('fs');
var nconf = require('nconf');
var Docker = require('./lib/docker');
var level = require('level');
var express = require('express');
var uuid = require('uuid');
var request = require('request');
var fetcher = require('./lib/fetcher');

var app = express();

nconf.env().file('local.json');

var docker;
if (nconf.get('docker:socketPath')) {
  docker = new Docker({ socketPath: nconf.get('docker:socketPath') });
} else {
  docker = new Docker({
    host: nconf.get('docker:host'),
    port: nconf.get('docker:port'),
    key: fs.readFileSync(nconf.get('docker:key')),
    cert: fs.readFileSync(nconf.get('docker:cert')),
    ca: fs.readFileSync(nconf.get('docker:ca'))
  });
}

var jobs = level(nconf.get('jobdb'), {
  createIfMissing: true,
  valueEncoding: 'json'
});

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

// verify needs a validator, and a project.
app.post('/api/v0/verify', function(req, res, next) {
  var validator = req.query.validator;
  var project = req.query.project;

  if (!validator || !project) return res.sendStatus(400);

  validator = 'docker.deepkeep.co/' + validator;
  project = 'http://www.deepkeep.co/' + project + '/package.zip';

  var jobId = uuid.v1();
  var job = {
    id: jobId,
    url: '/api/v0/job/' + jobId,
    state: 'SUBMITTED',
    submitted: Date.now(),
    validator: validator,
    project: project,
    callback: req.query.callback
  };

  jobs.put(jobId, job, function(err) {
    if (err) return res.statusCode(500);
    // response asap.
    res.status(202).json(job);

    fetcher.fetch(project, function(err, packagePath) {
      if (err) {
        job.state = 'FAILED';
        job.finished = Date.now();
        jobs.put(jobId, job, function(err) {
          if (err) debug('Failed to update job state %s', jobId);
        });
        return;
      }

      docker.buildImage(validator, function(err, imageId) {
        var containerOpts = {
          Image: imageId,
          NetworkDisabled: true,
          Binds: [packagePath + ':/project/package.zip:ro'],
          name: jobId
        }
        docker.runImage(containerOpts, function(err, containerId) {
          job.imageId = imageId;
          job.containerId = containerId;
          job.state = 'RUNNING';
          jobs.put(jobId, job, function(err) {
            if (err) debug('Failed to update job state %s', jobId);
          });
        });
      });
    });
  });
});

app.get('/api/v0/job/:id', function(req, res, next) {
  var id = req.params.id;
  jobs.get(id, function(err, job) {
    if (err) {
      if (err.notFound) {
        return res.sendStatus(404);
      }
      debug('Failed to fetch job %s', id);
      return res.sendStatus(500);
    }
    res.json(job);
  });
});

var dockerEmitter = docker.emitter();
dockerEmitter.start();

// die is emitted when building an image, so we only clean up containers used
// for running a job.
dockerEmitter.on('die', function(message) {
  var containerId = message.id;
  docker.getContainerName(containerId, function(err, jobId) {
    jobs.get(jobId, function(err, job) {
      if (!job) return;
      debug('Container finished executing %s for %s', containerId, jobId);
      docker.readContainerLogs(containerId, function(err, log) {
        docker.removeContainer(containerId);
        job.result = log;
        job.finished = Date.now();
        job.state = 'FINISHED';
        jobs.put(jobId, job, function(err) {
          if (err) debug('Failed to update job state %s', jobId);

          // callback
          if (job.callback) {
            var match = job.result.match(/SCORE: (\d+(?:\.\d+)?)/);
            if (match) {
              var score = parseFloat(match[1]);
              debug('Score match', score);
              request({
                uri: job.callback,
                method: 'POST',
                json: {
                  score: score
                }
              }, function(err, res) {
                debug('Callback POST done %s %s %s', job.callback, score, err);
              });
            }
          }
        });
      });
    });
  });
});

var port = nconf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
