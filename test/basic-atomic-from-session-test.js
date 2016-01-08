'use strict'

const Promise = require('bluebird')
const domain = require('domain')
const test = require('tap').test

const db = require('../db-session.js')

const LOGS = []

const runOperation = db.atomic(function runOperation (inner) {
  return db.getConnection().then(pair => {
    pair.release()
  })
})

// we're making sure that if we're in a session, we can
// jump directly to an atomic from the session, without
// having to explicitly start a transaction in-between.
test('test immediate atomic', assert => {
  LOGS.length = 0
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  domain1.run(() => {
    return runOperation()
  }).then(() => {
    assert.equal(process.domain, domain1)
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n').replace(/_[\d_]+$/gm, '_TS'), `
BEGIN
SAVEPOINT save_0_runOperation_TS
RELEASE SAVEPOINT save_0_runOperation_TS
COMMIT
release
`.trim())
    assert.equal(process.domain, undefined)
  }).then(() => assert.end())
    .catch(assert.end)
})

function innerGetConnection () {
  return {
    connection: {query (sql, ready) {
      LOGS.push(sql)
      return ready()
    }},
    release () {
      LOGS.push(`release`)
    }
  }
}

