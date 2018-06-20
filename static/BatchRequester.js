class BatchRequester {
  constructor() {
    this.responses = [];
    this.reset_();
  }

  reset_() {
    this.pendingSize_ = 0;
    this.batch = gapi.client.newBatch();
  }

  async add(request) {
    this.batch.add(request);
    this.pendingSize_++;
    if (this.pendingSize_ == BatchRequester.REQUEST_SIZE_LIMIT)
      await this.awaitResponses_();
  }

  async awaitResponses_() {
    let batch = this.batch;
    this.reset_();
    let responses = await batch;
    for (let key in responses.result) {
      this.responses.push(responses.result[key]);
    }
  }

  async complete() {
    if (this.pendingSize_)
      await this.awaitResponses_();
    return this.responses;
  }
}

// Gmail limits batch requests to 100 requests.
// But the documentation encourages limiting to 50
// to avoid rate limits.
BatchRequester.REQUEST_SIZE_LIMIT = 50;
