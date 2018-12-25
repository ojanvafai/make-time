import {fetchThreads} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {MailProcessor} from '../MailProcessor.js';
import {QueueSettings} from '../QueueSettings.js';
import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';

import {PlainThreadData, ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'triage-view';

export class TriageModel extends ThreadListModel {
  private bestEffortThreads_: Thread[]|null;
  private needsProcessingThreads_: Thread[];
  private threadsToSerialize_: PlainThreadData[];
  private mailProcessor_: MailProcessor;

  constructor(
      updateTitle: any, private vacation_: string, labels: Labels,
      settings_: Settings, private queueSettings_: QueueSettings) {
    super(updateTitle, labels, serializationKey);

    this.bestEffortThreads_ = [];
    this.needsProcessingThreads_ = [];
    this.threadsToSerialize_ = [];
    this.mailProcessor_ =
        new MailProcessor(settings_, this, queueSettings_, labels, updateTitle);
  }

  handleUndo(_thread: Thread) {}

  handleTriaged(_destination: string|null, _thread: Thread) {}

  async isBestEffortQueue(thread: Thread) {
    let queue = await thread.getQueue();
    let parts = queue.split('/');
    let lastPart = parts[parts.length - 1];
    let data = this.queueSettings_.get(lastPart);
    return data && data.goal == 'Best Effort';
  }

  // This function is all gross and hardcoded. Also, the constants themselves
  // aren't great. Would be best to know how long the email was actually in the
  // inbox rather than when the last email was sent, e.g. if someone was on
  // vacation. Could track the last N dequeue dates for each queue maybe?
  async isBankrupt(thread: Thread) {
    let messages = await thread.getMessages();
    let date = messages[messages.length - 1].date;
    let queue = await thread.getQueue();
    let queueData = this.queueSettings_.get(queue);

    let numDays = 7;
    if (queueData.queue == QueueSettings.WEEKLY)
      numDays = 14;
    else if (queueData.queue == QueueSettings.MONTHLY)
      numDays = 42;

    let oneDay = 24 * 60 * 60 * 1000;
    let diffDays = (Date.now() - date.getTime()) / (oneDay);
    return diffDays > numDays;
  }

  async bankruptThread(thread: Thread) {
    let queue = await thread.getQueue();
    queue = Labels.removeNeedsTriagePrefix(queue);
    let newLabel = Labels.addBankruptPrefix(queue);
    await thread.markTriaged(newLabel);
  }

  async addThread(thread: Thread) {
    // Threads with a priority have already been triaged, so don't add them.
    if (await thread.getPriority())
      return;

    if (this.vacation_ &&
        (this.vacation_ !== (await thread.getDisplayableQueue())))
      return;

    this.threadsToSerialize_.push(
        new PlainThreadData(thread.id, thread.historyId));

    if (!this.vacation_ && await this.isBestEffortQueue(thread)) {
      if (await this.isBankrupt(thread)) {
        await this.bankruptThread(thread);
        return;
      }

      if (this.bestEffortThreads_) {
        this.bestEffortThreads_.push(thread);
        this.dispatchEvent(new Event('best-effort-changed'));
        return;
      }
    }

    super.addThread(thread);
  }

  async getDisplayableQueue(thread: Thread) {
    return await thread.getDisplayableQueue();
  }

  compareRowGroups(a: any, b: any) {
    return this.queueSettings_.queueNameComparator(a.queue, b.queue);
  }

  hasBestEffortThreads() {
    return Boolean(
        this.bestEffortThreads_ && this.bestEffortThreads_.length !== 0);
  }

  resetBestEffort() {
    if (this.bestEffortThreads_)
      this.bestEffortThreads_ = [];
  }

  triageBestEffort() {
    if (!this.bestEffortThreads_)
      return;

    this.dispatchEvent(new Event('best-effort-changed'));

    let newThreads = this.bestEffortThreads_;
    this.bestEffortThreads_ = null;
    for (let thread of newThreads) {
      this.addThread(thread);
    }
  }

  // TODO: Store the list of threads in localStorage and update asynchronously.
  async fetch() {
    this.updateTitle('fetch', ' ');

    let labels = await this.labels.getThreadCountForLabels((label: string) => {
      return this.vacation_ ? label == Labels.needsTriageLabel(this.vacation_) :
                              Labels.isNeedsTriageLabel(label);
    });
    let labelsToFetch =
        labels.filter(data => data.count).map(data => data.name);
    labelsToFetch =
        this.queueSettings_.getSorted(labelsToFetch).map((item) => item[0]);

    this.resetBestEffort();

    let makeTimeLabels = this.labels.getMakeTimeLabelNames().filter(
        (item) => item != Labels.PROCESSED_LABEL);

    this.threadsToSerialize_ = [];
    let processThread = async (thread: Thread) => {
      // Threads that have triage labels but aren't in the inbox were archived
      // outside of maketime and should have their triage labels removed.
      if (!(await thread.isInInbox())) {
        await thread.markTriaged(null);
        return;
      }
      this.processThread(thread);
    };

    // Put threads that are in the inbox with no make-time labels first. That
    // way they always show up before daily/weekly/monthly bundles for folks
    // that don't want to filter 100% of their mail with make-time.
    await fetchThreads(processThread, {
      query: `in:inbox -(in:${makeTimeLabels.join(' OR in:')})`,
    });
    await this.fetchLabels(processThread, labelsToFetch);

    let threads = this.needsProcessingThreads_.concat();
    this.needsProcessingThreads_ = [];
    await this.mailProcessor_.processThreads(threads);

    await this.mailProcessor_.processUnprocessed();
    await this.mailProcessor_.processQueues();
    await this.mailProcessor_.collapseStats();

    await this.serializeThreads(this.threadsToSerialize_);

    this.updateTitle('fetch');
  }

  async processThread(thread: Thread) {
    let processedId = await this.labels.getId(Labels.PROCESSED_LABEL);
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];

    // Since processing threads is destructive (e.g. it removes priority
    // labels), only process threads in the inbox or with the unprocessed label.
    // Otherwise, they might be threads that are prioritized, but lack the
    // processed label for some reason.
    if (!lastMessage.getLabelIds().includes(processedId) &&
        ((await thread.isInInbox()) ||
         (await thread.getLabelNames()).has(Labels.UNPROCESSED_LABEL))) {
      this.needsProcessingThreads_.push(thread);
      return;
    }

    this.addThread(thread);
  }
}
