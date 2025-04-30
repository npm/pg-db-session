'use strict'

const test = require('tap').test

const domain = require('../lib/domain.js')
const db = require('../db-session.js')
const delay = require('../utils/delay')

const LOGS = []


const runOperations = db.transaction(function runOperations () {
  return Promise.all(Array.from(Array(8)).map((_, idx) => {
    return db.getConnection().then(connPair => {
      LOGS.push(`load ${idx}`)
      return delay(5).then(() => {
        LOGS.push(`release ${idx}`)
        connPair.release()
      })
    })
  }))
})

test('test root session concurrency=0', assert => {
  // compare to ./basic-session-concurrency-test.js, concurrency=1 —
  // operations should load and release in sequence, and be bookended
  // by "BEGIN" / "END"
  const start = process.domain
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  domain1.run(() => {
    return runOperations()
  }).then(() => {
    assert.equal(process.domain, start)
    domain1.exit()
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
BEGIN
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
COMMIT
release
`.trim())
    assert.equal(process.domain, start)
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
