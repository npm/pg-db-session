'use strict'

const DOMAIN_TO_SESSION = new WeakMap()
const Promise = require('bluebird')
const domain = require('domain')

const TxSessionConnectionPair = require('./lib/tx-session-connpair.js')
const SessionConnectionPair = require('./lib/session-connpair.js')

class NoSessionAvailable extends Error {
  constructor () {
    super('No session available')
    Error.captureStackTrace(this, NoSessionAvailable)
  }
}

function noop () {
}

const api = module.exports = {
  install (domain, getConnection, opts) {
    opts = Object.assign({
      maxConcurrency: Infinity,
      onSessionIdle: noop,
      onConnectionRequest: noop,
      onConnectionStart: noop,
      onConnectionFinish: noop,
      onTransactionRequest: noop,
      onTransactionStart: noop,
      onTransactionFinish: noop,
      onTransactionConnectionRequest: noop,
      onTransactionConnectionStart: noop,
      onTransactionConnectionFinish: noop,
      onAtomicRequest: noop,
      onAtomicStart: noop,
      onAtomicFinish: noop
    }, opts || {})
    DOMAIN_TO_SESSION.set(domain, new Session(
      getConnection,
      opts
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
    return api.session.getConnection()
  },

  get session () {
    var current = DOMAIN_TO_SESSION.get(process.domain)
    if (!current || current.inactive || !process.domain) {
      throw new NoSessionAvailable()
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
  constructor (getConnection, opts) {
    this._getConnection = getConnection
    this.activeConnections = 0
    this.maxConcurrency = opts.maxConcurrency || Infinity
    this.metrics = {
      onSessionIdle: opts.onSessionIdle,
      onConnectionRequest: opts.onConnectionRequest,
      onConnectionStart: opts.onConnectionStart,
      onConnectionFinish: opts.onConnectionFinish,
      onTransactionRequest: opts.onTransactionRequest,
      onTransactionStart: opts.onTransactionStart,
      onTransactionFinish: opts.onTransactionFinish,
      onTransactionConnectionRequest: opts.onTransactionConnectionRequest,
      onTransactionConnectionStart: opts.onTransactionConnectionStart,
      onTransactionConnectionFinish: opts.onTransactionConnectionFinish,
      onAtomicRequest: opts.onAtomicRequest,
      onAtomicStart: opts.onAtomicStart,
      onAtomicFinish: opts.onAtomicFinish
    }
    this.pending = []
  }

  getConnection () {
    const baton = {}
    this.metrics.onConnectionRequest(baton)
    if (this.activeConnections === this.maxConcurrency) {
      // not using Promise.defer() here in case it gets deprecated by
      // bluebird.
      const pending = _defer()
      this.pending.push(pending)
      return pending.promise
    }

    const connPair = Promise.resolve(this._getConnection())
    ++this.activeConnections

    return connPair.then(pair => {
      this.metrics.onConnectionStart(baton)
      return new SessionConnectionPair(pair, this, baton)
    })
  }

  transaction (operation, args) {
    const baton = {}
    const getConnPair = this.getConnection()
    this.metrics.onTransactionRequest(baton, operation, args)
    const getResult = Session$RunWrapped(this, connPair => {
      this.metrics.onTransactionStart(baton, operation, args)
      return new TransactionSession(connPair, this.metrics)
    }, getConnPair, `BEGIN`, {
      success: `COMMIT`,
      failure: `ROLLBACK`
    }, operation, args)

    const releasePair = getConnPair.then(pair => {
      return getResult.reflect().then(result => {
        this.metrics.onTransactionFinish(baton, operation, args, result)
        return result.isFulfilled()
          ? pair.release()
          : pair.release(result.reason())
      })
    })

    return releasePair.return(getResult)
  }

  atomic (operation, args) {
    return this.transaction(() => {
      return DOMAIN_TO_SESSION.get(process.domain).atomic(operation, args)
    }, args.slice())
  }

  releasePair (pair, err) {
    --this.activeConnections
    pair.release(err)
  }
}

class TransactionSession {
  constructor (connPair, metrics) {
    this.connectionPair = connPair
    this.inactive = false
    this.operation = Promise.resolve(true)
    this.metrics = metrics
  }

  getConnection () {
    if (this.inactive) {
      return new Promise((_, reject) => {
        reject(new NoSessionAvailable())
      })
    }

    const baton = {}
    this.metrics.onTransactionConnectionRequest(baton)
    // NB(chrisdickinson): creating a TxConnPair implicitly
    // swaps out "this.operation", creating a linked list of
    // promises.
    return new TxSessionConnectionPair(this, baton).onready
  }

  transaction (operation, args) {
    if (this.inactive) {
      return new Promise((_, reject) => {
        reject(new NoSessionAvailable())
      })
    }
    return operation.apply(null, args)
  }

  atomic (operation, args) {
    const baton = {}
    const atomicConnPair = this.getConnection()
    const savepointName = getSavepointName(operation)
    this.metrics.onAtomicRequest(baton, operation, args)
    const getResult = Session$RunWrapped(this, connPair => {
      this.metrics.onAtomicStart(baton, operation, args)
      return new AtomicSession(connPair, this.metrics, savepointName)
    }, atomicConnPair, `SAVEPOINT ${savepointName}`, {
      success: `RELEASE SAVEPOINT ${savepointName}`,
      failure: `ROLLBACK TO SAVEPOINT ${savepointName}`
    }, operation, args)

    const releasePair = atomicConnPair.then(pair => {
      return getResult.reflect().then(result => {
        this.metrics.onAtomicFinish(baton, operation, args, result)
        return result.isFulfilled()
          ? pair.release()
          : pair.release(result.reason())
      })
    })

    return releasePair.return(getResult)
  }
}

class AtomicSession extends TransactionSession {
  constructor (connection, metrics, name) {
    super(connection, metrics)
    this.name = name
  }
}

function Session$RunWrapped (parent,
                             createSession,
                             getConnPair,
                             before,
                             after,
                             operation,
                             args) {
  return getConnPair.then(pair => {
    const subdomain = domain.create()
    const session = createSession(pair)
    DOMAIN_TO_SESSION.set(subdomain, session)

    const runBefore = new Promise((resolve, reject) => {
      return pair.connection.query(
        before,
        err => err ? reject(err) : resolve()
      )
    })

    return runBefore.then(() => {
      const getResult = Promise.resolve(
        subdomain.run(() => Promise.try(() => {
          return operation.apply(null, args)
        }))
      )

      const reflectedResult = getResult.reflect()

      const waitOperation = Promise.join(
        reflectedResult,
        reflectedResult.then(() => session.operation)
      )
      .finally(markInactive(subdomain))
      .return(reflectedResult)

      const runCommitStep = waitOperation.then(result => {
        return new Promise((resolve, reject) => {
          return pair.connection.query(
            result.isFulfilled()
              ? after.success
              : after.failure,
            err => err ? reject(err) : resolve()
          )
        })
      })
      return runCommitStep.return(getResult)
    })
  })
}

function getSavepointName (operation) {
  const id = getSavepointName.ID++
  const dt = new Date().toISOString().replace(/[^\d]/g, '_').slice(0, -1)
  const name = (operation.name || 'anon').replace(/[^\w]/g, '_')
  // e.g., "save_13_userToOrg_2016_01_03_08_30_00_000"
  return `save_${id}_${name}_${dt}`
}
getSavepointName.ID = 0

function markInactive (subdomain) {
  return () => {
    subdomain.exit()
    DOMAIN_TO_SESSION.get(subdomain).inactive = true
    DOMAIN_TO_SESSION.set(subdomain, null)
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
