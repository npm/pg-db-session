'use strict'

const test = require('tap').test

require('./setup')
const domain = require('../lib/domain.js')
const db = require('../db-session.js')

test('test transaction outside of session', assert => {
  const testTransaction = db.transaction(function testTransaction () {
  })

  testTransaction()
    .then(() => { throw new Error('expected error') })
    .catch(db.NoSessionAvailable, () => assert.end())
    .catch(err => assert.end(err))
})

test('test atomic outside of session', assert => {
  const testAtomic = db.atomic(function testAtomic () {
  })

  return testAtomic()
    .then(() => { throw new Error('expected error') })
    .catch(err => {
      assert.type(err, db.NoSessionAvailable)
    })
})

test('test getConnection after release', assert => {
  const domain1 = domain.create()

  db.setup(() => process.domain)
  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
  })

  domain1.run(() => {
    return db.transaction(() => {
      const session = db.session
      setImmediate(() => {
        session.getConnection()
          .then(pair => { throw new Error('should not reach here') })
          .catch(err => {
            assert.type(err, db.NoSessionAvailable)
          })
          .finally(assert.end)
      })
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {async query (sql) {
        return
      }},
      release () {
      }
    }
  }
})

test('test transaction after release', assert => {
  const domain1 = domain.create()

  domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
  })

  domain1.run(() => {
    return db.transaction(() => {
      const session = db.session
      setImmediate(() => {
        session.transaction(() => {})
          .then(pair => { throw new Error('should not reach here') })
          .catch(err => {
            assert.type(err, db.NoSessionAvailable)
          })
          .finally(assert.end)
      })
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {
        async query (sql) {
        }
      },
      release () {
      }
    }
  }
})
