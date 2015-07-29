var debug = require('debug')('validation');
var util = require('util');
var events = require('events');
var conf = require('./conf');
var streamToPromise = require('stream-to-promise');
var streamToArray = require('stream-to-array');
var fetcher = require('./fetcher');
var uuid = require('uuid');

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

Validation.prototype.run = function(validator) {

  var downloadProjectPackage = function() {
    if (this.packagePath) return Promise.resolve(this.packagePath);
    return fetcher.fetch(this.project);
  }

  var pullImage = function(packagePath) {
    this.packagePath = packagePath;
    return this.docker.pull(validator);
  }

  var processPullResponse = function(response) {
    debug('Pulling validator image %s', validator);
    // we don't actually care about the data on the stream, just when it
    // finishes streaming data.
    return streamToPromise(response);
  }

  var createContainer = function() {
    debug('Creating container for %s', validator);
    return this.docker.createContainer({
      Image: validator,
      NetworkDisabled: true,
      Binds: [this.packagePath + ':/project/package.zip:ro'],
      name: this.job.id
    });
  }

  var startContainer = function(container) {
    debug('Starting container %s', container.id);
    this.job.validators[validator] = {
      id: container.id
    }
    return container.start();
  }

  var waitOnContainer = function() {
    var container = this.docker.getContainer(this.job.validators[validator].id);
    debug('Waiting for container termination %s', container.id);
    return container.wait();
  }

  var readContainerLogs = function() {
    var container = this.docker.getContainer(this.job.validators[validator].id);
    debug('Reading container logs %s', container.id);
    return container.logs({stdout: true});
  }

  var bufferContainerLogs = function(data) {
    debug('Buffering container logs %s', this.job.validators[validator].id);
    return streamToPromise(data);
  }

  var saveContainerLogsAndClean = function(logs) {
    var container = this.docker.getContainer(this.job.validators[validator].id);
    debug('Removing container %s', container.id);
    logs = this.job.validators[validator].result = logs.toString();
    container.remove();
    console.log(logs);
  }

  var handleError = function(error) {
    debug('Failed to execute %s - %s', validator, error);
    this.job.state = 'FAILED';
    this.job.finished = Date.now();
    this.job.error = error;
  }

  downloadProjectPackage.call(this)
    .then(pullImage.bind(this))
    .then(processPullResponse.bind(this))
    .then(createContainer.bind(this))
    .then(startContainer.bind(this))
    .then(waitOnContainer.bind(this))
    .then(readContainerLogs.bind(this))
    .then(bufferContainerLogs.bind(this))
    .then(saveContainerLogsAndClean.bind(this))
    .catch(handleError.bind(this));
};

module.exports = Validation;
