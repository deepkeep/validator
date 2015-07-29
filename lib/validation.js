var debug = require('debug')('validation');
var util = require('util');
var events = require('events');
var conf = require('./conf');
var streamToPromise = require('stream-to-promise');
var streamToArray = require('stream-to-array');

var Validation = function(docker, packagePath) {
  events.EventEmitter.call(this);
  this.docker = docker;
  this.packagePath = packagePath;
  this.validators = {};
}

// TODO: use events to update db state
util.inherits(Validation, events.EventEmitter);

function processPullResponse(response) {
  debug('Pulling validator image %s', validator);
  // we don't actually care about the data on the stream, just when it
  // finishes streaming data.
  return streamToPromise(response);
}

function createContainer() {
  debug('Creating container for %s', validator);
  return this.docker.createContainer({
    Image: validator,
    NetworkDisabled: true,
    Binds: [this.packagePath + ':/project/package.zip:ro'],
    // name: 'foobar2'
  });
}

function startContainer(container) {
  debug('Starting container %s', container.id);
  this.validators[validator] = {
    container: container
  }
  return container.start();
}

function waitOnContainer() {
  var container = this.validators[validator].container;
  debug('Waiting for container termination %s', container.id);
  return container.wait();
}

function readContainerLogs() {
  var container = this.validators[validator].container;
  debug('Reading container logs %s', container.id);
  return container.logs({stdout: true});
}

function bufferContainerLogs(data) {
  var container = this.validators[validator].container;
  debug('Buffering container logs %s', container.id);
  return new Promise(function(resolve, reject) {
    streamToArray(data, function(err, arr) {
      if (err) {
        reject(err);
      } else {
        resolve(Buffer.concat(arr).toString());
      }
    });
  });
}

function saveContainerLogsAndClean(logs) {
  var container = this.validators[validator].container;
  debug('Removing container %s', container.id);
  this.validators[validator].logs = logs;
  this.validators[validator].container.remove();
  console.log(logs);
}

Validation.prototype.run = function(validator) {
  this.docker.pull(validator)
    .then(processPullResponse.bind(this))
    .then(createContainer.bind(this))
    .then(startContainer.bind(this))
    .then(waitOnContainer.bind(this))
    .then(readContainerLogs.bind(this))
    .then(bufferContainerLogs.bind(this))
    .then(saveContainerLogsAndClean.bind(this))
    .catch(function() {
      debug('whoops', arguments);
    });
};

module.exports = Validation;
