var debug = require('debug')('validation');
var util = require('util');
var events = require('events');
var conf = require('./conf');
var streamToPromise = require('stream-to-promise');
var streamToArray = require('stream-to-array');
var fetcher = require('./fetcher');
var uuid = require('uuid');
var AdmZip = require('adm-zip');

function urlResolve() {
  var parts = Array.prototype.slice.call(arguments);
  return parts.join('/').replace(/\/+/g,'/').replace(/\:\//g, '://');
}

var Validation = function(docker, project) {
  events.EventEmitter.call(this);
  this.docker = docker;
  this.project = project;
  this.job = {
    id: uuid.v1(),
    state: 'SUBMITTED',
    submitted: Date.now(),
    validators: {}
  }
}

// TODO: use events to update db state
util.inherits(Validation, events.EventEmitter);

Validation.prototype.run = function() {
  var self = this;
  var packageUrl = urlResolve(conf.get('resolver:project'), self.project, 'package.zip');

  return fetcher.fetch(packageUrl)
    .then(function(packagePath) {
      self.packagePath = packagePath

      var zip = new AdmZip(packagePath);
      var packageJson = JSON.parse(zip.readAsText('package.json'));
      if (packageJson.validators) {
        var promises = packageJson.validators.map(function(validator) {
          debug('Submitting validator %s', validator.name);
          var validatorUrl = urlResolve(conf.get('resolver:validator'), validator.name);
          return self.validate(validatorUrl);
        });
        return Promise.all(promises);
      } else {
        return Promise.resolve(true);
      }
    })
    .then(function() {
      debug('Finished all validators');
      debug(self.job);
    })
    .catch(function(err) {
      debug('Failed to run all validators', err);
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
    self.job.validators[validator] = {
      id: container.id
    }
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
    var container = self.docker.getContainer(self.job.validators[validator].id);
    debug('Removing container %s', container.id);
    logs = self.job.validators[validator].result = logs.toString();
    container.remove();
    console.log(logs);
  }

  var handleError = function(error) {
    debug('Failed to execute %s - %s', validator, error);
    self.job.state = 'FAILED';
    self.job.finished = Date.now();
    self.job.error = error;
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
