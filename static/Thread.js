class Thread {
  constructor(thread, allLabels) {
    this.id = thread.id;
    this.snippet = thread.snippet;
    this.allLabels_ = allLabels;
  }

  clearDetails_() {
    this.labelIds_ = null;
    this.labelNames_ = null;
    this.queue_ = null;
    this.processedMessages_ = null;
  }

  processLabels_(messages) {
    this.labelIds_ = new Set();
    for (var message of messages) {
      for (let labelId of message.labelIds) {
        this.labelIds_.add(labelId);
      }
    }

    this.labelNames_ = [];
    for (let id of this.labelIds_) {
      let name = this.allLabels_.getName(id);
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }
      if (name.startsWith(Labels.NEEDS_TRIAGE_LABEL + '/'))
        this.setQueue(name);
      this.labelNames_.push(name);
    }

    if (!this.queue_)
      this.setQueue('inbox');
  }

  processMessages_(messages) {
    this.processLabels_(messages);
    if (!this.processedMessages_)
      this.processedMessages_ = [];
    let hasNewMessages = this.processedMessages_.length != messages.length;
    // Only process new messages.
    for (let i = this.processedMessages_.length; i < messages.length; i++) {
      let message = messages[i];
      let previousMessage = this.processedMessages_.length && this.processedMessages_[this.processedMessages_.length - 1];
      this.processedMessages_.push(new Message(message, previousMessage));
    }
    return hasNewMessages;
  }

  async modify(addLabelIds, removeLabelIds) {
    let request = {
      'userId': USER_ID,
      'id': this.id,
      'addLabelIds': addLabelIds,
      'removeLabelIds': removeLabelIds,
    };
    let response = await gapiFetch(gapi.client.gmail.users.threads.modify, request);
    // TODO: Handle response.status != 200.

    // Once a modify has happend the stored message details are stale and will need refeteching
    // if this Thread instance continued to be used.
    this.clearDetails_();
  }

  async markTriaged(destination) {
    if (destination === undefined)
      throw `Invalid triage action attempted.`;

    var addLabelIds = [];
    if (destination)
      addLabelIds.push(await this.allLabels_.getId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    var queue = await this.getQueue();
    if (queue)
      removeLabelIds.push(await this.allLabels_.getId(queue));
    await this.modify(addLabelIds, removeLabelIds);
    return {
      added: addLabelIds,
      removed: removeLabelIds,
      thread: this,
    }
  }

  isInInbox() {
    return this.labelIds_.has('INBOX');
  }

  async getLabelIds() {
    await this.fetchMessageDetails();
    return this.labelIds_;
  }

  async getLabelNames() {
    await this.fetchMessageDetails();
    return this.labelNames_;
  }

  async getSubject() {
    await this.fetchMessageDetails();
    return this.processedMessages_[0].subject;
  }

  async getMessages() {
    await this.fetchMessageDetails();
    return this.processedMessages_;
  }

  setQueue(queue) {
    this.queue_ = queue;
  }

  async getDisplayableQueue() {
    let queue = await this.getQueue();
    return Labels.removeNeedsTriagePrefix(queue);
  }

  async getQueue() {
    if (!this.queue_)
      await this.fetchMessageDetails();
    return this.queue_;
  }

  async updateMessageDetails() {
    if (!this.fetchPromise_) {
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;
    return this.processMessages_(resp.result.messages);
  }

  async fetchMessageDetails() {
    if (this.processedMessages_)
      return;
    return await this.updateMessageDetails();
  }
}

