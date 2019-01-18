'use strict'

const TxSessionConnectionPair = require('./lib/tx-session-connpair.js')
const SessionConnectionPair = require('./lib/session-connpair.js')

const sym = Symbol('context-to-session')

class NoSessionAvailable extends Error {
  constructor () {
    super('No session available')
    Error.captureStackTrace(this, NoSessionAvailable)
  }
}

function noop () {
}

let getContext = null

const api = module.exports = {
  setup (_getContext) {
    getContext = _getContext
  },

  install (getConnection, opts) {
    opts = Object.assign({
      maxConcurrency: Infinity,
      onSubsessionStart: noop,
      onSubsessionFinish: noop,
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

    getContext()[sym] = new Session(
      getConnection,
      opts
    )
  },

  atomic (operation) {
    return async function atomic$operation (...args) {
      return api.session.atomic(operation.bind(this), args)
    }
  },

  transaction (operation) {
    return async function transaction$operation (...args) {
      return api.session.transaction(operation.bind(this), args)
    }
  },

  getConnection () {
    return api.session.getConnection()
  },

  get session () {
    const context = getContext()
    var current = context && context[sym]
    if (!current || current.inactive || !context) {
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
      onSubsessionStart: opts.onSubsessionStart,
      onSubsessionFinish: opts.onSubsessionFinish,
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

  async transaction (operation, args) {
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

    const pair = await getConnPair
    try {
      const result = await getResult
      pair.release()

      return result
    } catch (err) {
      pair.release(err)

      throw err
    } finally {
      this.metrics.onTransactionFinish(baton, operation, args)
    }
  }

  atomic (operation, args) {
    return this.transaction(() => {
      return getContext()[sym].atomic(operation, args)
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
      return new Promise((resolve, reject) => {
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
      return new Promise((resolve, reject) => {
        reject(new NoSessionAvailable())
      })
    }
    return operation.apply(null, args)
  }

  async atomic (operation, args) {
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

    const pair = await atomicConnPair
    try {
      const result = await getResult
      pair.release()

      return result
    } catch (err) {
      pair.release(err)

      throw err
    } finally {
      this.metrics.onAtomicFinish(baton, operation, args)
    }
  }

  // NB: for use in tests _only_!)
  assign (context) {
    context[sym] = this
  }
}

class AtomicSession extends TransactionSession {
  constructor (connection, metrics, name) {
    super(connection, metrics)
    this.name = name
  }
}

async function Session$RunWrapped (parent,
                                   createSession,
                                   getConnPair,
                                   before,
                                   after,
                                   operation,
                                   args) {
  const pair = await getConnPair
  const subcontext = getContext().nest()
  const session = createSession(pair)
  parent.metrics.onSubsessionStart(parent, session)
  subcontext[sym] = session

  await pair.connection.query(before)
  subcontext.claim()
  try {
    var result = await operation(...args)
    await pair.connection.query(after.success)
    return result
  } catch (err) {
    await pair.connection.query(after.failure)
    throw err
  } finally {
    subcontext.end()
    session.inactive = true
    subcontext[sym] = null
    parent.metrics.onSubsessionFinish(parent, session)
  }
}

function getSavepointName (operation) {
  const id = getSavepointName.ID++
  const name = (operation.name || 'anon').replace(/[^\w]/g, '_')
  // e.g., "save_13_userToOrg_120101010"
  return `save_${id}_${name}_${process.pid}`
}
getSavepointName.ID = 0

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
