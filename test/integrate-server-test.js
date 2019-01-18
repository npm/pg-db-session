'use strict'

const test = require('tap').test
const http = require('http')

require('./setup')
const domain = require('../lib/domain.js')
const db = require('../db-session.js')

function runOperation () {
  return db.getConnection().then(pair => {
    pair.release()
    return 'ok!'
  })
}

test('test requests do not leak domains into requester', assert => {
  process.domain.exit()
  const server = http.createServer((req, res) => {
    const domain1 = domain.create()

    domain1.add(req)
    domain1.add(res)

    const result = domain1.run(() => {
      db.install(getConnection, {maxConcurrency: 0})
      return runOperation()
    })

    const removed = result.then(data => {
      domain1.remove(req)
      domain1.remove(res)
    })

    return removed.then(() => result).then(data => {
      res.end(data)
    })
  })

  server.listen(60808, () => {
    http.get('http://localhost:60808', res => {
      assert.ok(!process.domain)
      var acc = []
      res.on('data', data => {
        assert.ok(!process.domain)
        acc.push(data)
      })
      res.on('end', () => {
        assert.ok(!process.domain)
        server.close(() => {
          assert.end()
        })
      })
    })
  })

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
