'use strict'

const Promise = require('bluebird')
const domain = require('domain')
const test = require('tap').test

const db = require('../db-session.js')

test('test transaction outside of session', assert => {
  const testTransaction = db.transaction(function testTransaction () {
    return
  })

  testTransaction()
    .then(() => { throw new Error('expected error') })
    .catch(db.NoSessionAvailable, () => assert.end())
    .catch(err => assert.end(err))
})

test('test atomic outside of session', assert => {
  const testAtomic = db.atomic(function testAtomic () {
    return
  })

  testAtomic()
    .then(() => { throw new Error('expected error') })
    .catch(db.NoSessionAvailable, () => assert.end())
    .catch(err => assert.end(err))
})

test('test getConnection after release', assert => {
  const domain1 = domain.create()

  db.install(domain1, getConnection, {maxConcurrency: 0})
  
  domain1.run(() => {
    return db.transaction(() => {
      const session = db.session
      setImmediate(err => {
        session.getConnection()
          .then(pair => { throw new Error('should not reach here') })
          .catch(db.NoSessionAvailable, () => assert.ok(1, 'caught err'))
          .catch(err => assert.fail(err))
          .finally(assert.end)
      })
      return
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        return ready()
      }},
      release (err) {
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
      setImmediate(err => {
        session.transaction(() => {})
          .then(pair => { throw new Error('should not reach here') })
          .catch(db.NoSessionAvailable, () => assert.ok(1, 'caught err'))
          .catch(err => assert.fail(err))
          .finally(assert.end)
      })
      return
    })()
  })
  .catch(err => assert.fail(err))
  .finally(() => domain1.exit())

  function getConnection () {
    return {
      connection: {query (sql, ready) {
        return ready()
      }},
      release (err) {
      }
    }
  }
})
