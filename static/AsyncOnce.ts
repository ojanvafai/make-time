import {ASSERT_STRING} from './Base.js';

// Pattern for doing an async action exactly once even if it's called from
// multiple locations with async yields in the middle.
export class AsyncOnce<T> {
  private queued_: ((value?: T|PromiseLike<T>) => void)[];
  private asyncAction_: (() => PromiseLike<T>)|null;
  private hasValue_: boolean = false;
  private value_: T|null;
  private isDoing_: boolean = false;

  constructor(asyncAction:
                  ((value?: {}|PromiseLike<NonNullable<T>>) =>
                       PromiseLike<NonNullable<T>>)) {
    this.queued_ = [];
    this.asyncAction_ = asyncAction;
    this.value_ = null;
  }

  async do(): Promise<T> {
    if (this.hasValue_) {
      // TODO: Find a better way to have the type system allow for controlling
      // the uninitialized value of this.value_. This is kind of gross as it
      // doesn't allow for async functions that return null, but at least it
      // allows void functions.
      if (this.value_ === null)
        throw ASSERT_STRING;
      return this.value_;
    }

    if (this.isDoing_)
      return new Promise(resolve => this.queued_.push(resolve));

    this.isDoing_ = true;
    if (!this.asyncAction_)
      throw ASSERT_STRING;
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
