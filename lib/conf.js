var nconf = require('nconf');
nconf.env().file('local.json');
module.exports = nconf;
