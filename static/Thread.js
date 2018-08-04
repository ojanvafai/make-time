class Thread {
  constructor(thread) {
    this.id = thread.id;
    this.snippet = thread.snippet;
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
      // TODO: Don't use global state!
      let name = g_labels.idToLabel[id];
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }
      if (name.startsWith(TO_TRIAGE_LABEL + '/'))
        this.setQueue(name);
      this.labelNames_.push(name);
    }
  }

  processMessages_(messages) {
    this.processLabels_(messages);
    let processedMessages = [];
    for (var message of messages) {
      let previousMessageText = processedMessages.length && processedMessages[processedMessages.length - 1].html;
      processedMessages.push(new Message(message, previousMessageText));
    }
    this.processedMessages_ = processedMessages;
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
    var addLabelIds = [];
    if (destination)
      addLabelIds.push(await getLabelId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    var queue = await this.getQueue();
    if (queue)
      removeLabelIds.push(await getLabelId(queue));
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
    if (!queue)
      return 'inbox';
    return removeTriagedPrefix(queue);
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
    this.processMessages_(resp.result.messages);
  }

  async fetchMessageDetails() {
    if (this.processedMessages_)
      return;
    await this.updateMessageDetails();
  }
}

