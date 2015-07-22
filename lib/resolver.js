function resolve(root, name) {
  var match = name.match(/^([^/]+)\/([^/]+)$/);
  if (!match) {
    return name;
  }
  var paths = [root, match[1], match[2]];
  return paths.join('/');
}

exports.project = function(name) {
  return resolve('http://www.deepkeep.co', name) + '/package.zip';
}

exports.validator = function(name) {
  return resolve('http://docker.deepkeep.co', name);
}
