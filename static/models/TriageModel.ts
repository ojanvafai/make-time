import {fetchThreads} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {MailProcessor} from '../MailProcessor.js';
import {QueueSettings} from '../QueueSettings.js';
import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';

import {ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'triage-view';

export class TriageModel extends ThreadListModel {
  private bestEffortThreads_: Thread[]|null;
  private needsProcessingThreads_: Thread[];
  private needsMessageDetailsThreads_: Thread[];
  private needsArchivingThreads_: Thread[];
  private pendingThreads_: Thread[];
  private mailProcessor_: MailProcessor;

  constructor(
      private vacation_: string, labels: Labels, settings_: Settings,
      private queueSettings_: QueueSettings) {
    super(labels, serializationKey);

    this.bestEffortThreads_ = [];
    this.needsProcessingThreads_ = [];
    this.needsMessageDetailsThreads_ = [];
    this.needsArchivingThreads_ = [];
    this.pendingThreads_ = [];
    this.mailProcessor_ =
        new MailProcessor(settings_, this, queueSettings_, labels);
  }

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

  getGroupName(thread: Thread) {
    return thread.getDisplayableQueueSync();
  }

  protected compareThreads(a: Thread, b: Thread) {
    // Sort by queue, then by date.
    if (a.getQueueSync() == b.getQueueSync())
      return this.compareDates(a, b);
    return this.queueSettings_.queueNameComparator(
        a.getQueueSync(), b.getQueueSync());
  }

  hasBestEffortThreads() {
    return Boolean(
        this.bestEffortThreads_ && this.bestEffortThreads_.length !== 0);
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

  protected async fetch() {
    let labelsToFetch = this.vacation_ ?
        [Labels.needsTriageLabel(this.vacation_)] :
        this.labels.getNeedsTriageLabelNames();

    if (this.bestEffortThreads_)
      this.bestEffortThreads_ = [];
    this.pendingThreads_ = [];

    let needsTriageLabels = this.labels.getNeedsTriageLabelNames();
    let notInNeedsTriageLabels = needsTriageLabels.length ?
        `-(in:${needsTriageLabels.join(' OR in:')})` :
        '';
    let inInboxNoNeedsTriageLabel = `in:inbox ${notInNeedsTriageLabels}`;
    let hasNeedsTriageLabel =
        labelsToFetch.length ? `in:${labelsToFetch.join(' OR in:')}` : '';
    let inUnprocessed = `in:${Labels.UNPROCESSED_LABEL}`;

    // Fetch the list of threads, and then only populate the ones that are in
    // the disk storage so as to show the user an update as soon as possible.
    // Then process all the threads that need network of some sort one at a
    // time, showing the user an update after each of the network-bound threads
    // is processed.
    let skipNetwork = true;
    await fetchThreads(
        this.processThread_.bind(this),
        `(${inInboxNoNeedsTriageLabel}) OR (${hasNeedsTriageLabel}) OR (${
            inUnprocessed})`,
        skipNetwork);

    this.setThreads(this.pendingThreads_);
    this.pendingThreads_ = [];

    let needsMessageDetailsThreads = this.needsMessageDetailsThreads_.concat();
    this.needsMessageDetailsThreads_ = [];
    await this.doFetches_(needsMessageDetailsThreads);

    let threadsToProcess = this.needsProcessingThreads_.concat();
    this.needsProcessingThreads_ = [];
    await this.mailProcessor_.process(threadsToProcess);

    // Do these threads last since they are threads that have been archived
    // outside of maketime and just need to have their maketime labels removed,
    // so we don't need to block user visible thigns like processeing
    // unprocessed threads on it. Don't even show the user that anything is
    // happening (i.e. complete the updateTitle for this method before this).
    let threadsToArchive = this.needsArchivingThreads_.concat();
    this.needsArchivingThreads_ = [];
    for (let thread of threadsToArchive) {
      await thread.markTriaged(null);
    }
  }

  private async doFetches_(threads: Thread[]) {
    if (!threads.length)
      return;

    let progress = this.updateTitle(
        'TriageModel.doFetches_', threads.length, 'Updating thread list...');

    for (let thread of threads) {
      progress.incrementProgress();
      await thread.fetch();
      await this.processThread_(thread, true);
    }
  }

  private async processThread_(thread: Thread, addDirectly?: boolean) {
    if (!thread.hasMessageDetails) {
      // addDirectly should only ever be called for threads that have had their
      // message details fetched.
      if (addDirectly)
        throw 'Attempted to add a thread that lacked message details';
      this.needsMessageDetailsThreads_.push(thread);
      return;
    }

    let processedId = await this.labels.getId(Labels.PROCESSED_LABEL);
    let messages = await thread.getMessages();
    let lastMessage = messages[messages.length - 1];
    let isInInbox = await thread.isInInbox();
    let hasUnprocessedLabel =
        (await thread.getLabelNames()).has(Labels.UNPROCESSED_LABEL);

    // Since processing threads is destructive (e.g. it removes priority
    // labels), only process threads in the inbox or with the unprocessed label.
    // Otherwise, they might be threads that are prioritized, but lack the
    // processed label for some reason.
    if (!lastMessage.getLabelIds().includes(processedId) &&
        (isInInbox || hasUnprocessedLabel)) {
      this.needsProcessingThreads_.push(thread);
      return;
    }

    // Threads that have triage labels but aren't in the inbox were
    // archived outside of maketime and should have their triage labels
    // removed.
    if (!isInInbox) {
      this.needsArchivingThreads_.push(thread);
      return;
    }

    if (addDirectly)
      this.addThread(thread);
    else
      this.pendingThreads_.push(thread);
  }
}
