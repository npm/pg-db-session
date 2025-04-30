'use strict'

const test = require('tap').test

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

const LOGS = []
var shouldErrorToggle = false

// what happens when there's an error connecting?
test('cannot connect', assert => {
  LOGS.length = 0
  const domain1 = domain.create()
  class TestError extends Error {}

  db.install(domain1, () => new Promise((resolve, reject) => {
    reject(new TestError('cannot connect'))
  }), {maxConcurrency: 0})

  domain1.run(() => {
    return db.getConnection().then(pair => {
      pair.release()
    })
  }).then(() => {
    throw new Error('expected an exception')
  }).catch(err => {
    if(err instanceof TestError) {
        assert.ok(1, 'saw exception')
    } else {
        throw err
    }
  }).then(() => {
      domain1.exit()
  }).then(() => assert.end())
      .catch(assert.end)
  })

// what happens when there's an error querying?
test('query error', assert => {
  LOGS.length = 0
  const domain1 = domain.create()

  db.install(domain1, innerGetConnection, {maxConcurrency: 0})
  shouldErrorToggle = new Error('the kraken')

  domain1.run(() => {
    return db.getConnection().then(pair => {
      return new Promise((resolve, reject) => {
        pair.connection.query('FAKE QUERY', err => {
          err ? reject(err) : resolve()
        })
      }).then(pair.release, pair.release)
    })
  }).then(() => {
    assert.ok(true, 'pair.release does not rethrow')
    assert.equal(LOGS.join(' '), 'FAKE QUERY release the kraken')
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)
})

// what happens to pending connections when there's an error?
test('query error: pending connections', assert => {
  LOGS.length = 0
  const domain1 = domain.create()
  class TestError extends Error {}

  db.install(domain1, innerGetConnection, {maxConcurrency: 1})
  shouldErrorToggle = new TestError('the beast')

  var firstConnection = null
  var secondConnection = null
  domain1.run(() => {
    return Promise.all([
      db.getConnection().then(pair => {
        firstConnection = pair
        return new Promise((resolve, reject) => {
          pair.connection.query('FAKE QUERY', err => {
            err ? reject(err) : resolve()
          })
        }).then(pair.release, pair.release)
      }),
      db.getConnection().then(pair => {
        assert.ok(firstConnection)
        assert.notEqual(firstConnection, pair)
        secondConnection = pair
        return new Promise((resolve, reject) => {
          pair.connection.query('FAKE QUERY', err => {
            err ? reject(err) : resolve()
          })
        }).then(pair.release, pair.release)
      }),
      db.getConnection().then(pair => {
        assert.ok(secondConnection)
        assert.equal(secondConnection, pair)
        return new Promise((resolve, reject) => {
          pair.connection.query('FAKE QUERY', err => {
            err ? reject(err) : resolve()
          })
        }).then(pair.release, pair.release)
      })
    ])
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())
  .finally(assert.end)
})

function innerGetConnection () {
  return {
    connection: {query (sql, ready) {
      LOGS.push(sql)
      if (shouldErrorToggle) {
        var err = shouldErrorToggle
        shouldErrorToggle = false
        return ready(err)
      }
      return ready()
    }},
    release (err) {
      LOGS.push(`release ${err ? err.message : ''}`)
    }
  }
}
