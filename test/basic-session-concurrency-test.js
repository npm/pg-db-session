'use strict'

const Promise = require('bluebird')
const domain = require('domain')
const test = require('tap').test

const db = require('../db-session.js')

const LOGS = []

test('test root session concurrency=0', assert => {
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  domain1.run(() => {
    return runOperations()
  }).then(() => {
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
load 0
load 1
load 2
load 3
load 4
load 5
load 6
load 7
release 0
release
release 1
release
release 2
release
release 3
release
release 4
release
release 5
release
release 6
release
release 7
release
`.trim())
    assert.equal(process.domain, undefined)
  }).then(() => assert.end())
    .catch(assert.end)
})

test('test root session concurrency=1', assert => {
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 1})
  domain1.run(() => {
    return runOperations()
  }).then(() => {
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
load 0
release 0
load 1
release 1
load 2
release 2
load 3
release 3
load 4
release 4
load 5
release 5
load 6
release 6
load 7
release 7
release
`.trim())
    assert.equal(process.domain, undefined)
  }).then(() => assert.end())
    .catch(assert.end)
})

test('test root session concurrency=2', assert => {
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 2})
  domain1.run(() => {
    return runOperations()
  }).then(() => {
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
load 0
load 1
release 0
release 1
load 2
load 3
release 2
release 3
load 4
load 5
release 4
release 5
load 6
load 7
release 6
release
release 7
release
`.trim())
    assert.equal(process.domain, undefined)
  }).then(() => assert.end())
    .catch(assert.end)
})

test('test root session concurrency=4', assert => {
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 4})
  domain1.run(() => {
    return runOperations()
  }).then(() => {
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
load 0
load 1
load 2
load 3
release 0
release 1
release 2
release 3
load 4
load 5
load 6
load 7
release 4
release
release 5
release
release 6
release
release 7
release
`.trim())
    assert.equal(process.domain, undefined)
  }).then(() => assert.end())
    .catch(assert.end)
})

function innerGetConnection () {
  return {
    connection: {query () {
    }},
    release () {
      LOGS.push(`release`)
    }
  }
}

function runOperations () {
  LOGS.length = 0
  return Promise.all(Array.from(Array(8)).map((_, idx) => {
    return db.getConnection().then(connPair => {
      LOGS.push(`load ${idx}`)
      return Promise.delay(5).then(() => {
        LOGS.push(`release ${idx}`)
        connPair.release()
      })
    })
  }))
}
