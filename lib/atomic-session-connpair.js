'use strict'

const RESOLVE_SYM = Symbol()
const REJECT_SYM = Symbol()

module.exports = class AtomicSessionConnPair {
  constructor (session) {
    this.pair = session.connectionPair
    this.release = err => release(this, err)
    this.completed = new Promise((resolve, reject) => {
      this[RESOLVE_SYM] = resolve
      this[REJECT_SYM] = reject
    })
    this.onready = session.operation.then(() => this)
    session.operation = this.completed
  }

  get connection () {
    return this.pair.connection
  }

  close () {
    this[RESOLVE_SYM]()
  }
}

function release (conn, err) {
  if (err) {
    return conn[REJECT_SYM](err)
  }
}
