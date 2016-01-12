'use strict'

const Promise = require('bluebird')

const RESOLVE_SYM = Symbol()
const REJECT_SYM = Symbol()

// while SessionConnectionPair (./session-connpair.js) represents
// an *actual* postgres connection and "release" function,
// TransactionSessionConnPair *wraps* a SessionConnectionPair in
// order to serialize access to it. As such, "txPair.release()"
// doesn't release the underlying connection, it just lets
// subsequent operations run.
//
// the session machinery handles "fully" releasing the underlying
// connection — see Session#transaction and TransactionSession#atomic
// for more details (specifically, look for "release()".)
module.exports = class TransactionSessionConnPair {
  constructor (session, baton) {
    const metrics = session.metrics
    this.pair = session.connectionPair
    this.release = err => release(this, metrics, baton, err)
    this.completed = new Promise((resolve, reject) => {
      this[RESOLVE_SYM] = resolve
      this[REJECT_SYM] = reject
    }).catch((/* err */) => {
      // XXX(chrisdickinson): this would be the place to
      // add error monitoring.
    })

    // the onready promise will let session methods know
    // that previous operations have fully resolved —
    // "session.operation" is "txPair.completed", so we end
    // up with a linked list of promises, e.g.:
    //
    //                  duration of one transaction
    //                  _ _ _ _ _ _ _|_ _ _ _ _ _ _
    //                 /                           \
    //                |                             |
    //  completed → onready → (work happens) → completed → onready
    //
    this.onready = session.operation.then(() => {
      metrics.onTransactionConnectionStart(baton)
      return this
    })
    session.operation = this.completed
  }

  get connection () {
    return this.pair.connection
  }
}

function release (conn, metrics, baton, err) {
  metrics.onTransactionConnectionFinish(baton, err)
  return err ? conn[REJECT_SYM](err) : conn[RESOLVE_SYM]()
}
