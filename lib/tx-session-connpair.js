'use strict'

const RESOLVE_SYM = Symbol()
const REJECT_SYM = Symbol()

module.exports = class TransactionSessionConnPair {
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
}

function release (conn, err) {
  return err ? conn[REJECT_SYM](err) : conn[RESOLVE_SYM]()
}
