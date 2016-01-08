'use strict'

const DOMAIN_TO_SESSION = new WeakMap()
const Promise = require('bluebird')
const domain = require('domain')

const AtomicSessionConnectionPair = require('./lib/atomic-session-connpair.js')
const TxSessionConnectionPair = require('./lib/tx-session-connpair.js')
const SessionConnectionPair = require('./lib/session-connpair.js')

class NoSessionAvailable extends Error {
  constructor () {
    super('No session available')
    Error.captureStackTrace(this, NoSessionAvailable)
  }
}

const api = module.exports = {
  install (domain, getConnection, opts) {
    opts = opts || {}
    DOMAIN_TO_SESSION.set(domain, new Session(
      getConnection,
      opts.maxConcurrency
    ))
  },

  atomic (operation) {
    return function atomic$operation () {
      return Promise.try(() => {
        const args = [].slice.call(arguments)
        return api.session.atomic(operation, args)
      })
    }
  },

  transaction (operation) {
    return function transaction$operation () {
      return Promise.try(() => {
        const args = [].slice.call(arguments)
        return api.session.transaction(operation, args)
      })
    }
  },

  getConnection () {
    return DOMAIN_TO_SESSION.get(process.domain).getConnection()
  },

  get session () {
    var current = DOMAIN_TO_SESSION.get(process.domain)
    if (!current || !process.domain) {
      throw new NoSessionAvailable()
    }
    while (current.inactive && current.parent) {
      current = current.parent
    }
    return current
  },

  NoSessionAvailable
}

// how does this nest:
// 1. no transaction — session creates connections on-demand up till maxconcurrency
// 2. transaction — session holds one connection, gives it to requesters as-needed, one
//    at a time
// 3. atomic — grouped set of operations — parent transaction treats all connections performed
//    as a single operation
class Session {
  constructor (getConnection, maxConcurrency) {
    this._getConnection = getConnection
    this._activeConnections = 0
    this._maxConcurrency = maxConcurrency || Infinity
    this.pending = []
  }

  getConnection () {
    if (this._activeConnections === this._maxConcurrency) {
      // not using Promise.defer() here in case it gets deprecated by
      // bluebird.
      const pending = _defer()
      this.pending.push(pending)
      return pending.promise
    }

    const connPair = Promise.resolve(this._getConnection())
    ++this._activeConnections

    return connPair.then(
      pair => new SessionConnectionPair(pair, this)
    )
  }

  transaction (operation, args) {
    const getConnPair = this.getConnection()
    const getResult = Session$RunWrapped(this, connPair => {
      return new TransactionSession(this, connPair)
    }, getConnPair, `BEGIN`, {
      success: `COMMIT`,
      failure: `ROLLBACK`
    }, operation, args)
    const releasePair = getResult.return(getConnPair).then(
      pair => pair.release()
    )

    return releasePair.return(getResult)
  }

  atomic (operation, args) {
    return this.transaction(() => {
      return DOMAIN_TO_SESSION.get(process.domain).atomic(operation, args)
    }, args.slice())
  }

  releasePair (pair, err) {
    --this._activeConnections
    pair.release(err)
  }
}

class TransactionSession {
  constructor (parent, connPair) {
    this.parent = parent
    this.connectionPair = connPair
    this.inactive = false
    this.operation = Promise.resolve(true)
  }

  getConnection () {
    if (this.inactive) {
      return this.parent.getConnection()
    }
    // XXX(chrisdickinson): creating a TxConnPair implicitly
    // swaps out "this.operation", creating a linked list of
    // promises.
    return new TxSessionConnectionPair(this).onready
  }

  transaction (operation, args) {
    if (this.inactive) {
      return this.parent.transaction(operation, args)
    }
    return operation.apply(null, args)
  }

  atomic (operation, args) {
    const atomicConnPair = new AtomicSessionConnectionPair(this)
    const savepointName = getSavepointName(operation)
    const getResult = Session$RunWrapped(this, connPair => {
      return new AtomicSession(this, connPair, savepointName)
    }, atomicConnPair.onready, `SAVEPOINT ${savepointName}`, {
      success: `RELEASE SAVEPOINT ${savepointName}`,
      failure: `ROLLBACK TO SAVEPOINT ${savepointName}`
    }, operation, args)

    return getResult.then(() => {
      setImmediate(() => {
        atomicConnPair.close()
      })
    }).return(getResult)
  }
}

class AtomicSession extends TransactionSession {
  constructor (parent, connection, name) {
    super(parent, connection)
    this.name = name
  }
}

function Session$RunWrapped (parent,
                             createSession,
                             getConnPair, before, after, operation, args) {
  const createSubdomain = getConnPair.then(connPair => {
    const subdomain = domain.create()
    const session = createSession(connPair)
    DOMAIN_TO_SESSION.set(subdomain, session)
    return subdomain
  })

  const runBefore = getConnPair.then(connPair => new Promise(
    (resolve, reject) => connPair.connection.query(
      before,
      err => err ? reject(err) : resolve()
    )
  ))

  const getResult = runBefore.return(
    createSubdomain
  ).then(domain => {
    args.unshift(operation)
    return Promise.resolve(domain.run.apply(domain, args))
  })

  const getReflectedResult = getResult.reflect()
  const runCommitStep = Promise.join(
    getReflectedResult,
    getConnPair.get('connection')
  ).spread((result, connection) => {
    return new Promise((resolve, reject) => {
      connection.query(
        result.isFulfilled()
          ? after.success
          : after.failure,
        err => err ? reject(err) : resolve()
      )
    })
  })

  return runCommitStep.return(
    createSubdomain
  ).then(markInactive(parent)).return(getResult)
}

function getSavepointName (operation) {
  const id = getSavepointName.ID++
  const dt = new Date().toISOString().replace(/[^\d]/g, '_').slice(0, -1)
  const name = (operation.name || 'anon').replace(/[^\w]/g, '_')
  // e.g., "save_13_userToOrg_2016_01_03_08_30_00_000"
  return `save_${id}_${name}_${dt}`
}
getSavepointName.ID = 0

function markInactive (session) {
  return domain => {
    domain.exit()
    DOMAIN_TO_SESSION.get(domain).inactive = true

    // if, somehow, we get a reference to this domain again, point
    // it at the parent session.
    DOMAIN_TO_SESSION.set(domain, session)
  }
}

function _defer () {
  const pending = {
    resolve: null,
    reject: null,
    promise: null
  }
  pending.promise = new Promise((resolve, reject) => {
    pending.resolve = resolve
    pending.reject = reject
  })
  return pending
}
