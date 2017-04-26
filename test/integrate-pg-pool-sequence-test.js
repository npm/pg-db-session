'use strict'

const spawn = require('child_process').spawn
const Promise = require('bluebird')
const test = require('tap').test
const pg = require('pg')

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

  db.install(domain1, getConnection, {maxConcurrency: 0})
  db.install(domain2, getConnection, {maxConcurrency: 0})

  const runOne = domain1.run(() => runOperation(domain1))
    .then(() => {
      domain1.exit()
      assert.ok(!process.domain)
    })

  const runTwo = runOne.then(() => {
    return domain2.run(() => runOperation(domain2))
  }).then(() => {
    domain2.exit()
    assert.ok(!process.domain)
  })

  return runTwo
    .catch(assert.fail)
    .finally(() => pg.end())
    .finally(assert.end)

  function getConnection () {
    return new Promise((resolve, reject) => {
      pg.connect(`postgres://localhost/${TEST_DB_NAME}`, onconn)

      function onconn (err, connection, release) {
        err ? reject(err) : resolve({connection, release})
      }
    })
  }

  function runOperation (expectDomain) {
    assert.equal(process.domain, expectDomain)
    const getConnPair = db.getConnection()

    const runSQL = getConnPair.get('connection').then(conn => {
      assert.equal(process.domain, expectDomain)
      return new Promise((resolve, reject) => {
        assert.equal(process.domain, expectDomain)
        conn.query('SELECT 1', (err, data) => {
          assert.equal(process.domain, expectDomain)
          err ? reject(err) : resolve(data)
        })
      })
    })

    const runRelease = runSQL.return(getConnPair).then(
      pair => pair.release()
    )

    return runRelease.return(runSQL)
  }
})

test('teardown', assert => teardown().then(assert.end))
