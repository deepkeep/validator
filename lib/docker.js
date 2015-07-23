var debug = require('debug')('docker');
var Dockerode = require('dockerode');
var DockerEvents = require('docker-events');
var streamToArray = require('stream-to-array');

var Docker = function(opts) {
  this.docker = new Dockerode(opts);
}

Docker.prototype.emitter = function() {
  this.emitter = new DockerEvents({ docker: this.docker });
  return this.emitter;
};

Docker.prototype.buildImage = function(verifier, cb) {
  debug('Building image from %s', verifier);
  var docker = this.docker;
  docker.pull(verifier, function (err, response) {
    if (err) return cb(err);

    docker.modem.followProgress(response, function(err) {
      if (err) return cb(err);
      docker.getImage(verifier).inspect(function(err, data) {
        if (err) return cb(err);
        debug('Built image for %s %s', verifier, data.Id);
        cb(null, data.Id);
      });
    });
  });
};

Docker.prototype.runImage = function(opts, cb) {
  // TODO falcon: err handling;
  // TODO falcon: lots and lots of options here
  // TODO falcon: https://docs.docker.com/reference/api/docker_remote_api_v1.19/#create-a-container
  debug('Building container from %s for %s', opts.Image, opts.name);
  var docker = this.docker;
  docker.createContainer(opts, function (err, container) {
    container.start(function (err) {
      debug('Starting container %s', container.id);
      cb(err, container.id);
    });
  });
};

Docker.prototype.removeContainer = function(containerId, cb) {
  var docker = this.docker;
  var container = docker.getContainer(containerId);
  container.inspect(function(err, data) {
    if (err) return cb(err);
    var imageId = data.Image;
    container.remove(function(err) {
      debug('Removing container %s %s', containerId, err);
      var image = docker.getImage(imageId);
      image.remove(function(err) {
        debug('Removing image %s %s', imageId, err);
      });
    });
  });
};

Docker.prototype.readContainerLogs = function(containerId, cb) {
  debug('Reading container logs %s', containerId);
  var docker = this.docker;
  var container = docker.getContainer(containerId);
  container.logs({stdout: true}, function(err, data) {
    if (err) return cb(err);
    streamToArray(data, function(err, arr) {
      cb(null, Buffer.concat(arr).toString());
    });
  });
};

Docker.prototype.getContainerName = function(containerId, cb) {
  var docker = this.docker;
  docker.getContainer(containerId).inspect(function(err, data) {
    if (err) return cb(err);
    // name of container starts with '/'
    return cb(null, data.Name.substring(1));
  });
};

module.exports = Docker;
