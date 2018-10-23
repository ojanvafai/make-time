class Thread {
  constructor(thread, allLabels) {
    this.id = thread.id;
    this.historyId = thread.historyId;
    this.snippet = thread.snippet;
    this.allLabels_ = allLabels;
  }

  clearDetails_() {
    this.labelIds_ = null;
    this.labelNames_ = null;
    this.queue_ = null;
    this.triagedQueue_ = null;
    this.priority_ = null;
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
      else if (name.startsWith(Labels.TRIAGED_LABEL + '/'))
        this.triagedQueue_ = name;
      else if (name.startsWith(Labels.PRIORITY_LABEL + '/'))
        this.priority_ = name;

      this.labelNames_.push(name);
    }

    if (!this.queue_)
      this.setQueue('inbox');
  }

  processMessages_(messages) {
    this.processLabels_(messages);
    if (!this.processedMessages_)
      this.processedMessages_ = [];
    let newMessages = messages.slice(this.processedMessages_.length);
    // Only process new messages.
    let newProcessedMessages = [];
    for (let message of newMessages) {
      let previousMessage = this.processedMessages_.length && this.processedMessages_[this.processedMessages_.length - 1];
      let processed = new Message(message, previousMessage);
      this.processedMessages_.push(processed);
      newProcessedMessages.push(processed);
    }
    return newProcessedMessages;
  }

  async modify(addLabelIds, removeLabelIds) {
    // Make sure that any added labels are not also removed.
    // Gmail API will fail if you try to add and remove the same label.
    removeLabelIds = removeLabelIds.filter((item) => !addLabelIds.includes(item));

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

    return {
      added: addLabelIds,
      removed: removeLabelIds,
      thread: this,
    }
  }

  async setPriority(destination) {
    if (destination === undefined)
      throw `Invalid priority attempted.`;

    var addLabelIds = [await this.allLabels_.getId(destination)];
    var removeLabelNames = this.allLabels_.getPriorityLabelNames().filter(item => item != destination);
    let removeLabelIds = await this.allLabels_.getIds(removeLabelNames);
    return await this.modify(addLabelIds, removeLabelIds);
  }

  async markTriaged(destination, opt_queue) {
    if (destination === undefined)
      throw `Invalid triage action attempted.`;

    // Need the message details to get the list of current applied labels.
    // Almost always we will have fetched this since we're showing the message
    // to the user already.
    await this.fetchMessageDetails();

    var addLabelIds = [];
    if (destination)
      addLabelIds.push(await this.allLabels_.getId(destination));

    var removeLabelIds = ['UNREAD', 'INBOX'];
    if (destination) {
      // TODO: Should probably remove all make-time/needstriage labels here. Although, in theory
      // there should never be two make-time/needstriage labels on a given thread.
      var queue = opt_queue || await this.getQueue();
      if (queue)
        removeLabelIds.push(await this.allLabels_.getId(queue));
    } else {
      // If archiving, remove all make-time labels except unprocessed. Don't want
      // archiving a thread to remove this label without actually processing it.
      let unprocessedId = await this.allLabels_.getId(Labels.UNPROCESSED_LABEL);
      let makeTimeIds = this.allLabels_.getMakeTimeLabelIds().filter((item) => item != unprocessedId);
      removeLabelIds = removeLabelIds.concat(makeTimeIds);
    }

    // Only remove labels that are actually on the thread. That way
    // undo will only reapply labels that were actually there.
    removeLabelIds = removeLabelIds.filter((item) => this.labelIds_.has(item));

    return await this.modify(addLabelIds, removeLabelIds);
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
    return this.processedMessages_[0].subject || '(no subject)';
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

  async getDisplayableTriagedQueue() {
    let queue = await this.getTriagedQueue();
    return Labels.removeTriagedPrefix(queue);
  }

  async getTriagedQueue() {
    await this.fetchMessageDetails();
    if (!this.triagedQueue_)
      throw 'Attempting to get triage queue of untriaged thread.';
    return this.triagedQueue_;
  }

  async getPriority() {
    await this.fetchMessageDetails();
    return this.priority_;
  }

  async fetchMessageDetails_(forceNetwork) {
    let key = `thread-${getCurrentWeekNumber()}-${this.historyId}`;

    if (!forceNetwork) {
      let localData = await IDBKeyVal.getDefault().get(key);
      if (localData)
        return JSON.parse(localData);
    }

    if (!this.fetchPromise_) {
      this.fetchPromise_ = gapiFetch(gapi.client.gmail.users.threads.get, {
        userId: USER_ID,
        id: this.id,
      })
    }
    let resp = await this.fetchPromise_;
    this.fetchPromise_ = null;

    let messages = resp.result.messages;
    try {
      await IDBKeyVal.getDefault().set(key, JSON.stringify(messages));
    } catch (e) {
      console.log('Fail storing message details in IDB.', e);
    }
    return messages;
  }

  async updateMessageDetails(forceNetwork) {
    let messages = await this.fetchMessageDetails_(forceNetwork);
    return this.processMessages_(messages);
  }

  async fetchMessageDetails() {
    if (this.processedMessages_)
      return;
    return await this.updateMessageDetails();
  }

  async sendReply(replyText, extraEmails, shouldReplyAll) {
    let messages = await this.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Gmail will remove dupes for us.
    let to = lastMessage.from
    if (shouldReplyAll)
      to += ',' + lastMessage.to;

    if (extraEmails.length)
      to += ',' + extraEmails.join(',');

    let subject = lastMessage.subject;
    let replyPrefix = 'Re: ';
    if (subject && !subject.startsWith(replyPrefix))
      subject = replyPrefix + subject;

    let email = `Subject: ${subject}
In-Reply-To: ${lastMessage.messageId}
To: ${to}
Content-Type: text/html; charset="UTF-8"
`;

    if (shouldReplyAll && lastMessage.cc)
      email += `Cc: ${lastMessage.cc}\n`;

    email += `
  ${replyText}<br><br>${lastMessage.from} wrote:<br>
  <blockquote class="gmail_quote" style="margin:0 0 0 .8ex;border-left:1px #ccc solid;padding-left:1ex">
    ${lastMessage.getHtmlOrPlain()}
  </blockquote>`;

    let base64 = new Base64();
    let response = await gapiFetch(gapi.client.gmail.users.messages.send, {
      'userId': USER_ID,
      'resource': {
        'raw': base64.encode(email),
        'threadId': this.id,
      }
    });
  }
}
