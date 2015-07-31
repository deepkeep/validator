var debug = require('debug')('validation');
var util = require('util');
var events = require('events');
var conf = require('./conf');
var streamToPromise = require('stream-to-promise');
var fetcher = require('./fetcher');
var uuid = require('uuid');
var AdmZip = require('adm-zip');

function urlResolve() {
  var parts = Array.prototype.slice.call(arguments);
  return parts.join('/').replace(/\/+/g,'/').replace(/\:\//g, '://');
}

function scoreLogs(logs) {
  var match = logs.match(/SCORE: (\d+(?:\.\d+)?)/);
  if (match) {
    return parseFloat(match[1]);
  }
  return null;
}

var Validation = function(docker, project) {
  events.EventEmitter.call(this);
  this.docker = docker;
  this.project = project;
  var jobid = uuid.v1();
  this.job = {
    id: jobid,
    url: '/api/v0/job/' + jobid,
    state: 'SUBMITTED',
    submitted: Date.now(),
    validators: {}
  }
}

util.inherits(Validation, events.EventEmitter);

Validation.prototype.run = function() {
  var self = this;
  var packageUrl = urlResolve(conf.get('resolver:project'), self.project, 'package.zip');

  return fetcher.fetch(packageUrl)
    .then(function(result) {
      self.packagePath = result.packagePath;
      self.cleanup = result.cleanup;

      var zip = new AdmZip(self.packagePath);
      var packageJson = JSON.parse(zip.readAsText('package.json'));
      if (packageJson.validators) {
        var promises = packageJson.validators.map(function(validator) {
          debug('Submitting validator %s', validator.name);
          var validatorUrl = urlResolve(conf.get('resolver:validator'), validator.name);
          if (self.job.validators.hasOwnProperty(validatorUrl)) return true;
          self.job.validators[validatorUrl] = {};
          return self.validate(validatorUrl);
        });
        self.job.state = 'RUNNING';
        self.emit('update');
        return Promise.all(promises);
      } else {
        return Promise.resolve(true);
      }
    })
    .then(function() {
      debug('Finished all validators for %s', self.project);
      self.job.state = 'FINISHED';
      self.job.finished = Date.now();
      debug('Cleaning up package.zip %s', self.packagePath);
      self.cleanup();
      self.emit('update');
      self.emit('end');
    })
    .catch(function(err) {
      debug('Failed to validate %s %s', self.project, error);
      self.job.state = 'FAILED';
      self.job.finished = Date.now();
      self.job.error = error;
      debug('Cleaning up package.zip %s', self.packagePath);
      self.cleanup();
      self.emit('update');
      self.emit('end');
    });
}

Validation.prototype.validate = function(validator) {
  var self = this;

  var processPullResponse = function(response) {
    debug('Pulling validator image %s', validator);
    // we don't actually care about the data on the stream, just when it
    // finishes streaming data.
    return streamToPromise(response);
  }

  var createContainer = function() {
    debug('Creating container for %s', validator);
    return self.docker.createContainer({
      Image: validator,
      NetworkDisabled: true,
      Binds: [self.packagePath + ':/project/package.zip:ro']
    });
  }

  var startContainer = function(container) {
    debug('Starting container %s', container.id);
    self.job.validators[validator].id = container.id;
    return container.start();
  }

  var waitOnContainer = function() {
    var container = self.docker.getContainer(self.job.validators[validator].id);
    debug('Waiting for container termination %s', container.id);
    return container.wait();
  }

  var readContainerLogs = function() {
    var container = self.docker.getContainer(self.job.validators[validator].id);
    debug('Reading container logs %s', container.id);
    return container.logs({stdout: true});
  }

  var bufferContainerLogs = function(data) {
    debug('Buffering container logs %s', self.job.validators[validator].id);
    return streamToPromise(data);
  }

  var saveContainerLogsAndClean = function(logs) {
    logs = logs.toString();

    var v = self.job.validators[validator];
    debug('Removing container %s', v.id);

    v.result = logs.toString();
    var score = scoreLogs(logs);
    if (score) {
      v.score = score;
    }

    self.emit('update');
    self.docker.getContainer(v.id).remove();
  }

  var handleError = function(error) {
    debug('Failed to execute %s - %s', validator, error);
    self.job.state = 'FAILED';
    self.job.finished = Date.now();
    self.job.error = error;
    self.emit('update');
    self.emit('end');
  }

  return this.docker.pull(validator)
    .then(processPullResponse)
    .then(createContainer)
    .then(startContainer)
    .then(waitOnContainer)
    .then(readContainerLogs)
    .then(bufferContainerLogs)
    .then(saveContainerLogsAndClean)
    .catch(handleError);
};

module.exports = Validation;
