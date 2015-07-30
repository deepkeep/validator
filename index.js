var debug = require('debug')('index');
var fs = require('fs');
var conf = require('./lib/conf');
var Dockerode = require('dockerode-promise');
var level = require('level');
var express = require('express');
var request = require('request');
var Validation = require('./lib/validation');

var app = express();

var docker;
if (conf.get('docker:socketPath')) {
  docker = new Dockerode({ socketPath: conf.get('docker:socketPath') });
} else {
  docker = new Dockerode({
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

app.use(function requestLogger(req, res, next) {
  console.log(req.method + ' ' + req.url);
  next();
});

app.post('/api/v0/validate', function(req, res, next) {
  var project = req.query.project;
  if (!project) return res.sendStatus(400);

  var validation = new Validation(docker, project);
  jobs.put(validation.job.id, validation.job, function(err) {
    if (err) return res.statusCode(500);

    // respond asap.
    res.status(202).json(validation.job);

    validation.on('update', function() {
      jobs.put(validation.job.id, validation.job, function(err) {
        if (err) debug('Failed to update leveldb');
      })
    });
    validation.run();
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


// // callback
// if (job.callback) {
//   var match = job.result.match(/SCORE: (\d+(?:\.\d+)?)/);
//   if (match) {
//     var score = parseFloat(match[1]);
//     debug('Score match', score);
//     request({
//       uri: job.callback,
//       method: 'POST',
//       json: {
//         score: score
//       }
//     }, function(err, res) {
//       debug('Callback POST done %s %s %s', job.callback, score, err);
//     });
//   }
// }

var port = conf.get('port');
app.listen(port, function() {
  console.log("Listening on " + port);
});
