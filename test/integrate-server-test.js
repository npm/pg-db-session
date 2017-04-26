'use strict'

const test = require('tap').test
const http = require('http')

const domain = require('../lib/domain.js')
const db = require('../db-session.js')

function runOperation () {
  return db.getConnection().then(pair => {
    pair.release()
    return 'ok!'
  })
}

test('test requests do not leak domains into requester', assert => {
  const server = http.createServer((req, res) => {
    const domain1 = domain.create()
    db.install(domain1, getConnection, {maxConcurrency: 0})

    domain1.add(req)
    domain1.add(res)

    const result = domain1.run(() => {
      return runOperation()
    })

    const removed = result.then(data => {
      domain1.remove(req)
      domain1.remove(res)
    })

    return removed.return(result).then(data => {
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
      connection: {query (sql, ready) {
        return ready()
      }},
      release () {
      }
    }
  }
})
