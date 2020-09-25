'use strict'

const Promise = require('bluebird')
const test = require('tap').test

require('./setup')
const domain = require('../lib/domain.js')
const db = require('../db-session.js')

// what happens if there's an error in the previous query?
// - a failed query should not automatically end the transaction
// - only returning a promise will end the transaction
test('test error in previous query', assert => {
  const domain1 = domain.create()

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return db.transaction(() => {
      const first = db.getConnection().then(conn => {
        return conn.connection.query('ONE')
          .then(() => conn.release())
          .catch(err => conn.release(err))
      })

      const second = first.then(() => {
        return db.getConnection()
      }).then(conn => {
        return conn.connection.query('TWO')
          .then(() => conn.release())
          .catch(err => conn.release(err))
      })

      return second.then(() => 'expect this value')
    })()
  })
  .then(value => assert.equal(value, 'expect this value'))
  .catch(err => assert.fail(err.stack))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {
        async query (sql, ready) {
          if (sql === 'ONE') {
            throw new Error('failed')
          }
        }
      },
      release () {
      }
    }
  }
})

// what happens if BEGIN fails
test('test error in BEGIN', assert => {
  const domain1 = domain.create()
  class BeginError extends Error {}

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return db.transaction(() => {
      assert.fail('should not reach here.')
    })()
  })
  .catch(err => assert.type(err, BeginError))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    var trippedBegin = false
    return {
      connection: {
        async query (sql, ready) {
          if (trippedBegin) {
            assert.fail('should not run subsequent queries')
          }
          if (sql === 'BEGIN') {
            trippedBegin = true
            throw new BeginError('failed BEGIN')
          }
        }
      },
      release () {
      }
    }
  }
})

// what happens if COMMIT / ROLLBACK fails
test('test error in COMMIT', assert => {
  const domain1 = domain.create()
  class CommitError extends Error {}

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return db.transaction(() => {
      return db.getConnection().then(pair => pair.release())
    })()
  })
  .catch(err => assert.type(err, CommitError))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {
        async query (sql, ready) {
          if (sql === 'COMMIT') {
            throw new CommitError('failed COMMIT')
          }
        }
      },
      release () {
      }
    }
  }
})

test('test error in ROLLBACK: does not reuse connection', assert => {
  const domain1 = domain.create()
  class RollbackError extends Error {}

  var connectionPair = null
  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 1})
    const first = db.transaction(() => {
      return db.getConnection().then(pair => {
        connectionPair = pair.pair
        pair.release()
        throw new Error('any kind of error, really')
      })
    })().then(xs => {}, xs => {})

    const second = db.getConnection().then(pair => {
      // with concurrency=1, we will try to re-use
      // the connection if we can. since we had an error,
      // it's best not to use the connection!
      assert.notEqual(connectionPair, pair)
      pair.release()
    })

    return Promise.join(first, second)
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {
        async query (sql) {
          if (sql === 'ROLLBACK') {
            throw new RollbackError('failed ROLLBACK')
          }
        }
      },
      release () {
      }
    }
  }
})
