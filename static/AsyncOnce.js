// Pattern for doing an async action exactly once even if it's called from
// multiple locations with async yields in the middle.
export class AsyncOnce {
  constructor(asyncAction) {
    this.queued_ = [];
    this.asyncAction_ = asyncAction;
  }

  async do() {
    if (this.hasValue_)
      return this.value_;

    if (this.isDoing_)
      return new Promise(resolve => this.queued_.push(resolve));

    this.isDoing_ = true;
    this.value_ = await this.asyncAction_();
    this.hasValue_ = true;
    this.isDoing_ = false;

    for (let resolve of this.queued_) {
      resolve();
    }
    delete this.queued_;
    this.asyncAction_ = null;

    return this.value_;
  }
}
