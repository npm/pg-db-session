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

if (false)
test('test atomic after release', assert => {
})

if (false)
test('test transaction after release', assert => {
})
