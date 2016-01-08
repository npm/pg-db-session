# pg-db-session

Abuse domains to get a form of continuation local storage. Associate all events
originating from a single domain to a single database session, which manages
maximum concurrency, transactions, and operation ordering for consumers of the
database connection.

```javascript
const db = require('pg-db-session')
const domain = require('domain')
const http = require('http')
const pg = require('pg')

http.createServer((req, res) => {
  const d = domain.create()
  d.add(req)
  d.add(res)

  db.install(d, () => {
    return new Promise((resolve, reject) => {
      pg.connect(CONFIG, (err, connection, release) => {
        err ? reject(err) : resolve({connection, release})
      })
    })
  }, {maxConcurrency: 2})

  d.run(() => {
    // handle some code.
    someOperation()
    someAtomic()
  })
})

const someOperation = db.transaction(function operation () {
  // this code will always run inside an operation
  return db.getConnection().then(pair => {
    pair.connection.query('DELETE FROM all', err => pair.release(err))
  })
})

const someAtomic = db.atomic(function atom () {
  // this code will always be run inside an operation together,
  // with savepoints.
})
```
