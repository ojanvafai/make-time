class Thread {
  constructor(thread) {
    this.id = thread.id;
    this.snippet = thread.snippet;
  }

  addLabelIds(labelIds, idToLabelNames) {
    this.labelIds = labelIds;
    this.labelNames = [];
    for (let id of labelIds) {
      let name = idToLabelNames[id];
      if (!name) {
        console.log(`Label id does not exist. WTF. ${id}`);
        continue;
      }
      if (name.startsWith(TO_TRIAGE_LABEL + '/'))
        this.queue = name;
      this.labelNames.push(name);
    }
  }

  addMessages(messages) {
    this.messages = messages;
  }
}
