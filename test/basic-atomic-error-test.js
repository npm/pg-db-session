'use strict'

const test = require('tap').test

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

// what happens if there's an error in the previous query?
// - a failed query should not automatically end the atomic
// - only returning a promise will end the atomic
test('test error in previous query', assert => {
  const domain1 = domain.create()

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.atomic(() => {
      const first = db.getConnection().then(conn => {
        return new Promise((resolve, reject) => {
          conn.connection.query('ONE', err => {
            if (err) return reject(err)
            resolve()
          })
        }).then(() => conn.release())
          .catch(err => conn.release(err))
      })

      const second = first.then(() => {
        return db.getConnection()
      }).then(conn => {
        return new Promise((resolve, reject) => {
          conn.connection.query('TWO', err => {
            if (err) return reject(err)
            resolve()
          })
        }).then(() => conn.release())
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
      connection: {query (sql, ready) {
        if (sql === 'ONE') {
          return ready(new Error('failed'))
        }
        return ready()
      }},
      release () {
      }
    }
  }
})

// what happens if BEGIN fails
test('test error in BEGIN', assert => {
  const domain1 = domain.create()
  class BeginError extends Error {}

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.atomic(() => {
      assert.fail('should not reach here.')
    })()
  })
  .catch(err => {
    if(err instanceof BeginError) {
        assert.ok(1, 'caught expected err')
    }
    assert.fail(err)
  })
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    var trippedBegin = false
    return {
      connection: {query (sql, ready) {
        if (trippedBegin) {
          assert.fail('should not run subsequent queries')
        }
        if (sql === 'BEGIN') {
          trippedBegin = true
          return ready(new BeginError('failed BEGIN'))
        }
        return ready()
      }},
      release () {
      }
    }
  }
})

// what happens if COMMIT / ROLLBACK fails
test('test error in COMMIT', assert => {
  const domain1 = domain.create()
  class CommitError extends Error {}

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.atomic(() => {
      return db.getConnection().then(pair => pair.release())
    })()
  })
  .catch(err => {
    if(err instanceof CommitError) {
        assert.ok(1, 'caught expected error')
    } 
    assert.fail(err)
  })
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        if (sql === 'COMMIT') {
          return ready(new CommitError('failed COMMIT'))
        }
        return ready()
      }},
      release () {
      }
    }
  }
})

test('test error in ROLLBACK: does not reuse connection', assert => {
  const domain1 = domain.create()
  class RollbackError extends Error {}

  db.install(domain1, getConnection, {maxConcurrency: 1})

  var connectionPair = null
  domain1.run(() => {
    const first = db.atomic(() => {
      return db.getConnection().then(pair => {
        connectionPair = pair.pair
        pair.release()
        throw new Error('any kind of error, really')
      })
    })().catch(() => {})

    const second = db.getConnection().then(pair => {
      // with concurrency=1, we will try to re-use
      // the connection if we can. since we had an error,
      // it's best not to use the connection!
      assert.notEqual(connectionPair, pair)
      pair.release()
    })

    return Promise.all([first, second])
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        if (sql === 'ROLLBACK') {
          return ready(new RollbackError('failed ROLLBACK'))
        }
        return ready()
      }},
      release () {
      }
    }
  }
})