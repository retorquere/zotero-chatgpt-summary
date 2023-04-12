export class Deferred<ReturnType> {
  public promise: Promise<ReturnType>
  public resolve: (v: ReturnType) => void
  public reject: (e: any) => void

  constructor() {
    this.promise = new Promise((resolve, reject) => {
      this.resolve = resolve
      this.reject = reject
    })// as Promise<ReturnType>
    for (const op of ['then', 'catch']) {
      this[op] = this.promise[op]?.bind(this.promise)
    }
    // this.then = this.promise.then.bind(this.promise)
    // this.catch = this.promise.catch.bind(this.promise)
  }
}
