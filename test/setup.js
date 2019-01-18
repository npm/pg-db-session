/* eslint-disable node/no-deprecated-api */
const db = require('../db-session.js')
const domain = require('domain')

db.setup(() => process.domain)

domain.Domain.prototype.end = domain.Domain.prototype.exit
domain.Domain.prototype.nest = function () {
  const subdomain = domain.create()
  subdomain.enter()
  return subdomain
}

domain.Domain.prototype.claim = function () {
}
