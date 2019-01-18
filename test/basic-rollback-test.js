'use strict'

const test = require('tap').test

require('./setup')
const domain = require('../lib/domain.js')
const db = require('../db-session.js')

const LOGS = []

test('rolling back transaction calls ROLLBACK', assert => {
  const domain1 = domain.create()

  LOGS.length = 0

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return db.transaction(() => {
      throw new Error('no thanks')
    })().then(
      xs => [null, xs],
      xs => [xs, null]
    )
  })
  .then(() => assert.equal(LOGS.join(' '), 'BEGIN ROLLBACK'))
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {
        async query (sql) {
          LOGS.push(sql)
        }
      },
      release () {
      }
    }
  }
})

test('rolling back atomic calls ROLLBACK', assert => {
  const domain1 = domain.create()

  LOGS.length = 0

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return db.atomic(() => {
      throw new Error('no thanks')
    })().then(
      xs => [null, xs],
      xs => [xs, null]
    )
  })
  .then(() => {
    assert.equal(LOGS.join('\n').replace(/_[\d_]+$/gm, '_TS'), `
BEGIN
SAVEPOINT save_0_bound_TS
ROLLBACK TO SAVEPOINT save_0_bound_TS
ROLLBACK
`.trim())
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {
        async query (sql) {
          LOGS.push(sql)
        }
      },
      release () {
      }
    }
  }
})
