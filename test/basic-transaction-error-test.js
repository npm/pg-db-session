'use strict'

const Promise = require('bluebird')
const domain = require('domain')
const test = require('tap').test

const db = require('../db-session.js')

// what happens if there's an error in the previous query?
// - a failed query should not automatically end the transaction
// - only returning a promise will end the transaction
test('test error in previous query', assert => {
  const domain1 = domain.create()

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.transaction(() => {
      const first = db.getConnection().then(conn => {
        return Promise.promisify(conn.connection.query)('ONE')
          .then(() => conn.release())
          .catch(err => conn.release(err))
      })

      const second = first.then(() => {
        return db.getConnection()
      }).then(conn => {
        return Promise.promisify(conn.connection.query)('TWO')
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
      connection: {query (sql, ready) {
        if (sql === 'ONE') {
          return ready(new Error('failed'))
        }
        return ready()
      }},
      release (err) {
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
    return db.transaction(() => {
      assert.fail('should not reach here.')
    })()
  })
  .catch(BeginError, err => assert.ok(1, 'caught expected err'))
  .catch(err => assert.fail(err))
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
      release (err) {
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
    return db.transaction(() => {
      return db.getConnection().then(pair => pair.release())
    })()
  })
  .catch(CommitError, () => assert.ok(1, 'caught expected error'))
  .catch(err => assert.fail(err))
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
      release (err) {
      }
    }
  }
})
return
test('test error in ROLLBACK', assert => {
  const domain1 = domain.create()

  db.install(domain1, () => new Promise((_, reject) => {
    reject(new TestError('cannot connect'))
  }), {maxConcurrency: 0})
  
  domain1.run(() => {
    return db.transaction(() => {
      assert.fail('should not reach here.')
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)
})

// what happens when getConnection fails before BEGIN
test('test getConnection error', assert => {
  const domain1 = domain.create()

  db.install(domain1, () => new Promise((_, reject) => {
    reject(new TestError('cannot connect'))
  }), {maxConcurrency: 0})
  
  domain1.run(() => {
    return db.transaction(() => {
      assert.fail('should not reach here.')
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)
})

function innerGetConnection () {
  return {
    connection: {query (sql, ready) {
      if (shouldErrorToggle) {
        var err = shouldErrorToggle
        shouldErrorToggle = false
        return ready(err)
      }
      return ready()
    }},
    release (err) {
    }
  }
}
