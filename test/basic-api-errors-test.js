'use strict'

const test = require('tap').test

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

test('test transaction outside of session', assert => {
  const testTransaction = db.transaction(function testTransaction () {
  })

  testTransaction()
    .then(() => { throw new Error('expected error') })
    .catch(err => {
      if(err instanceof db.NoSessionAvailable) {
          assert.end()
      }
      assert.end(err)
    })
})

test('test atomic outside of session', assert => {
  const testAtomic = db.atomic(function testAtomic () {
  })

  testAtomic()
    .then(() => { throw new Error('expected error') })
    .catch(err => {
      if(err instanceof db.NoSessionAvailable) {
          assert.end()
      }
      assert.end(err)
    })
})

test('test getConnection after release', assert => {
  const domain1 = domain.create()

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.transaction(() => {
      const session = db.session
      setImmediate(() => {
        session.getConnection()
          .then(pair => { throw new Error('should not reach here') })
          .catch(err => {
            if(err instanceof db.NoSessionAvailable) {
                assert.ok(1, 'caught err')
            }
            assert.fail(err)
          })
          .finally(assert.end)
      })
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        return ready()
      }},
      release () {
      }
    }
  }
})

test('test transaction after release', assert => {
  const domain1 = domain.create()

  db.install(domain1, getConnection, {maxConcurrency: 0})

  domain1.run(() => {
    return db.transaction(() => {
      const session = db.session
      setImmediate(() => {
        session.transaction(() => {})
          .then(pair => { throw new Error('should not reach here') })
          .catch(err => {
            if(err instanceof db.NoSessionAvailable) {
                assert.ok(1, 'caught err')
            }
            assert.fail(err)
          })
          .finally(assert.end)
      })
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        return ready()
      }},
      release () {
      }
    }
  }
})
