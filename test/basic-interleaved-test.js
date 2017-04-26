'use strict'

const test = require('tap').test
const fs = require('fs')

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

// this is pretty much just testing domains
test('test of interleaved requests', assert => {
  const domain1 = domain.create()
  const domain2 = domain.create()

  db.install(domain1, getFakeConnection)
  db.install(domain2, getFakeConnection)

  var pending = 3

  domain1.run(() => {
    const firstSession = db.session
    fs.readFile(__filename, () => {
      assert.equal(firstSession, db.session)
      domain2.run(() => {
        assert.ok(firstSession !== db.session)
        const secondSession = db.session
        setTimeout(() => {
          assert.equal(secondSession, db.session)
          !--pending && end()
        }, 100)
        fs.readFile(__filename, () => {
          assert.equal(secondSession, db.session)
          !--pending && end()
        })
      })
      setTimeout(() => {
        assert.equal(firstSession, db.session)
        !--pending && end()
      }, 100)
    })
  })

  function end () {
    process.domain.exit()
    assert.end()
  }

  function getFakeConnection () {
    return {
      connection: {query () {
      }},
      release () {
      }
    }
  }
})
