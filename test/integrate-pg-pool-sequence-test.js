'use strict'

const spawn = require('child_process').spawn
const Promise = require('bluebird')
const test = require('tap').test
const pg = require('pg')

require('./setup')
const domain = require('../lib/domain.js')
const db = require('../db-session.js')

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'pg_db_session_test'

function setup () {
  return teardown().then(() => new Promise(resolve => {
    spawn('createdb', [TEST_DB_NAME]).on('exit', resolve)
  }))
}

function teardown () {
  return new Promise(resolve => {
    spawn('dropdb', [TEST_DB_NAME]).on('exit', resolve)
  })
}

test('setup', assert => setup().then(assert.end))

test('pg pooling does not adversely affect operation', assert => {
  const domain1 = domain.create()
  const domain2 = domain.create()
  const pool = new pg.Pool(`postgres://localhost/${TEST_DB_NAME}`)

  const d = process.domain
  const runOne = domain1.run(() => {
    db.install(getConnection, {maxConcurrency: 0})
    return runOperation(domain1)
  }).then(() => {
    domain1.exit()
    assert.equal(process.domain, d)
  })

  const runTwo = runOne.then(() => {
    return domain2.run(() => {
      db.install(getConnection, {maxConcurrency: 0})
      return runOperation(domain2)
    })
  }).then(() => {
    domain2.exit()
    assert.equal(process.domain, d)
  })

  return runTwo
    .catch(assert.fail)
    .finally(() => pool.end())
    .finally(assert.end)

  function getConnection () {
    return new Promise((resolve, reject) => {
      pool.connect(onconn)

      function onconn (err, connection, release) {
        err ? reject(err) : resolve({connection, release})
      }
    })
  }

  function runOperation (expectDomain) {
    assert.equal(process.domain, expectDomain)
    const getConnPair = db.getConnection()

    const runSQL = getConnPair.then(xs => xs.connection).then(conn => {
      assert.equal(process.domain, expectDomain)
      return new Promise((resolve, reject) => {
        assert.equal(process.domain, expectDomain)
        conn.query('SELECT 1', (err, data) => {
          assert.equal(process.domain, expectDomain)
          err ? reject(err) : resolve(data)
        })
      })
    })

    const runRelease = runSQL.then(() => getConnPair).then(
      pair => pair.release()
    )

    return runRelease.then(() => runSQL)
  }
})

test('teardown', assert => teardown().then(assert.end))
