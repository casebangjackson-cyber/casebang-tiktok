'use strict';

const { appendLog, readJson, writeJson } = require('./store');

function log(level, source, message, detail) {
  return appendLog({ level, source, message, detail });
}

module.exports = { log };
