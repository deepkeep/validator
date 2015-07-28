var debug = require('debug')('index');
var fs = require('fs');
var conf = require('./lib/conf');
var Docker = require('./lib/docker');
var level = require('level');
var express = require('express');
var uuid = require('uuid');
var request = require('request');
var fetcher = require('./lib/fetcher');

var app = express();

var docker;
if (conf.get('docker:socketPath')) {
  docker = new Docker({ socketPath: conf.get('docker:socketPath') });
} else {
  docker = new Docker({
    host: conf.get('docker:host'),
    port: conf.get('docker:port'),
    key: fs.readFileSync(conf.get('docker:key')),
    cert: fs.readFileSync(conf.get('docker:cert')),
    ca: fs.readFileSync(conf.get('docker:ca'))
  });
}

var jobs = level(conf.get('jobdb'), {
  createIfMissing: true,
  valueEncoding: 'json'
});

function urlResolve() {
  var parts = Array.prototype.slice.call(arguments);
  return parts.join('/').replace(/\/+/g,'/').replace(/\:\//g, '://');
}

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

app.post('/api/v0/validate', function(req, res, next) {
  var validator = req.query.validator;
  var project = req.query.project;

  if (!validator || !project) return res.sendStatus(400);

  validator = urlResolve(conf.get('resolver:validator'), validator);
  project = urlResolve(conf.get('resolver:project'), project, 'package.zip');

  debug('Validating %s with %s', project, validator);

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
          // Binds: [packagePath + ':/project/package.zip:ro'],
          VolumesFrom: ['validatortmp:ro']
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

var port = conf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
