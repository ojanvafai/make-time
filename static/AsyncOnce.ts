// Pattern for doing an async action exactly once even if it's called from
// multiple locations with async yields in the middle.
export class AsyncOnce<T> {
  private queued_: ((value?: T|PromiseLike<T>) => void)[];
  private asyncAction_: (() => PromiseLike<T>)|null;
  private hasValue_: boolean = false;
  private value_: T|undefined;
  private isDoing_: boolean = false;

  constructor(asyncAction: ((value?: {}|PromiseLike<T>) => PromiseLike<T>)) {
    this.queued_ = [];
    this.asyncAction_ = asyncAction;
  }

  async do(): Promise<T> {
    if (this.hasValue_) {
      if (this.value_ === undefined)
        throw ('Something went wrong. This should never happen.')
        return this.value_;
    }

    if (this.isDoing_)
      return new Promise(resolve => this.queued_.push(resolve));

    this.isDoing_ = true;
    if (!this.asyncAction_)
      throw 'Something went wrong. This should never happen.';
    this.value_ = await this.asyncAction_();
    this.hasValue_ = true;
    this.isDoing_ = false;

    for (let resolve of this.queued_)
      resolve(this.value_);
    delete this.queued_;
    this.asyncAction_ = null;

    return this.value_;
  }
}
