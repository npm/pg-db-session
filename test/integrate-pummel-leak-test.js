'use strict'

const childProcess = require('child_process')
const Promise = require('bluebird')
const domain = require('domain')
const spawn = childProcess.spawn
const pg = require('pg')

const db = require('../db-session.js')

const TEST_DB_NAME = process.env.TEST_DB_NAME || 'pg_db_session_test'
const IS_MAIN = !Boolean(process.env.TAP)

if (process.env.IS_CHILD) {
  runChild()
} else {
  const test = require('tap').test
  test('setup', assert => setup().then(assert.end))
  test('pummel: make sure we are not leaking memory', runParent)
  test('teardown', assert => teardown().then(assert.end))
}

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

function runParent (assert) {
  const child = spawn(process.execPath, [
    '--expose_gc',
    '--max_old_space_size=32',
    __filename
  ], {
    env: Object.assign({}, process.env, {
      IS_CHILD: 1,
      TEST_DB_NAME,
      BLUEBIRD_DEBUG: 0
    })
  })

  if (IS_MAIN) {
    child.stderr.pipe(process.stderr)
  }
  const gotSignal = new Promise(resolve => {
    child.once('close', code => {
      resolve(code)
    })
  })

  const checkCode = gotSignal.then(code => {
    assert.equal(code, 0)
  })

  return checkCode
    .catch(err => assert.fail(err))
    .finally(assert.end)
}

function runChild () {
  // if we leak domains, given a 32mb old space size we should crash in advance
  // of this number
  const ITERATIONS = 70000
  var count = 0
  var pending = 20

  var resolve = null
  const doRun = new Promise(_resolve => resolve = _resolve)

  function iter () {
    if (count % 1000 === 0) {
      process._rawDebug(count, process.memoryUsage())
    }
    if (++count < ITERATIONS) {
      return run().then(iter)
    }
    return !--pending && resolve()
  }

  for (var i = 0; i < 20; ++i) {
    iter()
  }

  return doRun
    .finally(() => pg.end())

  function run () {
    const domain1 = domain.create()

    db.install(domain1, getConnection, {maxConcurrency: 0})

    return domain1.run(() => runOperation()).then(() => {
      domain1.exit()
    })
  }

  function runOperation () {
    const getConnPair = db.getConnection()

    const runSQL = getConnPair.get('connection').then(conn => {
      return new Promise((resolve, reject) => {
        conn.query('SELECT 1', (err, data) => {
          err ? reject(err) : resolve(data)
        })
      })
    })

    const runRelease = runSQL.return(getConnPair).then(
      pair => pair.release()
    )

    return runRelease.return(runSQL)
  }

  function getConnection () {
    return new Promise((resolve, reject) => {
      pg.connect(`postgres://localhost/${TEST_DB_NAME}`, onconn)

      function onconn (err, connection, release) {
        err ? reject(err) : resolve({connection, release})
      }
    })
  }
}
