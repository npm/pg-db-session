'use strict'

const test = require('tap').test

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

const LOGS = []

const delay = ms => new Promise(resolve => setTimeout(resolve, ms))

const runOperations = db.transaction(function runOperations (inner) {
  return Promise.all(Array.from(Array(4)).map((_, idx) => {
    return idx % 2 === 0 ? inner(idx) : db.getConnection().then(connPair => {
      LOGS.push(`load ${idx}`)
      return delay(5).then(() => {
        LOGS.push(`release ${idx}`)
        connPair.release()
      })
    })
  }))
})

function runSubOperation (rootIdx) {
  return Promise.all(Array.from(Array(4)).map((_, idx) => {
    return delay(5).then(() => {
      return db.getConnection().then(connPair => {
        LOGS.push(`load ${rootIdx} ${idx}`)
        return delay(5).then(() => {
          LOGS.push(`release ${rootIdx} ${idx}`)
          connPair.release()
        })
      })
    })
  }))
}

const txRunSubOperation = db.transaction(runSubOperation)
const atomicRunSubOperation = db.atomic(runSubOperation)

test('test nested transaction order', assert => {
  LOGS.length = 0
  const start = process.domain
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  domain1.run(() => {
    return runOperations(txRunSubOperation)
  }).then(() => {
    assert.equal(process.domain, start)
  }).then(() => {
    assert.equal(LOGS.join('\n'), `
BEGIN
load 1
release 1
load 3
release 3
load 0 0
release 0 0
load 0 1
release 0 1
load 0 2
release 0 2
load 0 3
release 0 3
load 2 0
release 2 0
load 2 1
release 2 1
load 2 2
release 2 2
load 2 3
release 2 3
COMMIT
release
`.trim())
    assert.equal(process.domain, start)
  })
  .catch(err => assert.fail(err.stack))
  .finally(() => domain1.exit())
  .finally(assert.end)
})

test('test nested atomic transaction order', assert => {
  LOGS.length = 0
  const start = process.domain
  const domain1 = domain.create()
  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  domain1.run(() => {
    return runOperations(atomicRunSubOperation)
  }).then(() => {
    assert.equal(process.domain, start)
  }).then(() => {
    assert.equal(LOGS.join('\n').replace(/_[\d_]+$/gm, '_TS'), `
BEGIN
SAVEPOINT save_0_bound_runSubOperation_TS
load 0 0
release 0 0
load 0 1
release 0 1
load 0 2
release 0 2
load 0 3
release 0 3
RELEASE SAVEPOINT save_0_bound_runSubOperation_TS
load 1
release 1
SAVEPOINT save_1_bound_runSubOperation_TS
load 2 0
release 2 0
load 2 1
release 2 1
load 2 2
release 2 2
load 2 3
release 2 3
RELEASE SAVEPOINT save_1_bound_runSubOperation_TS
load 3
release 3
COMMIT
release
`.trim())
    assert.equal(process.domain, start)
  })
  .catch(err => assert.fail(err.stack))
  .finally(() => domain1.exit())
  .finally(assert.end)
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
