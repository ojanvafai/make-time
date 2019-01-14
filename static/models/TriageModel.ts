import {assert} from '../Base.js';
import {fetchThreads, threadCache} from '../BaseMain.js';
import {Labels} from '../Labels.js';
import {MailProcessor} from '../MailProcessor.js';
import {QueueSettings} from '../QueueSettings.js';
import {Settings} from '../Settings.js';
import {Thread} from '../Thread.js';
import {ThreadFetcher} from '../ThreadFetcher.js';

import {ThreadListModel} from './ThreadListModel.js';

let serializationKey = 'triage-view';
// Put a hard cap for folks that have infinitely large inboxes to not have a
// terrible first experience of maketime.
let maxThreadsToShow = 1000;

export class TriageModel extends ThreadListModel {
  private bestEffortThreads_: Thread[]|null;
  private needsProcessingThreads_: Thread[];
  private needsFetchThreads_: ThreadFetcher[];
  private needsArchivingThreads_: Thread[];
  private pendingThreads_: Thread[];
  private mailProcessor_: MailProcessor;

  constructor(
      private vacation_: string, labels: Labels, settings_: Settings,
      private queueSettings_: QueueSettings) {
    super(labels, serializationKey);

    this.bestEffortThreads_ = [];
    this.needsProcessingThreads_ = [];
    this.needsFetchThreads_ = [];
    this.needsArchivingThreads_ = [];
    this.pendingThreads_ = [];
    this.mailProcessor_ =
        new MailProcessor(settings_, this, queueSettings_, labels);
  }

  handleTriaged(_destination: string|null, _thread: Thread) {}

  private isBestEffortQueue_(thread: Thread) {
    let queue = thread.getQueue();
    let parts = queue.split('/');
    let lastPart = parts[parts.length - 1];
    let data = this.queueSettings_.get(lastPart);
    return data && data.goal == 'Best Effort';
  }

  // This function is all gross and hardcoded. Also, the constants themselves
  // aren't great. Would be best to know how long the email was actually in the
  // inbox rather than when the last email was sent, e.g. if someone was on
  // vacation. Could track the last N dequeue dates for each queue maybe?
  private isBankrupt_(thread: Thread) {
    let messages = thread.getMessages();
    let date = messages[messages.length - 1].date;
    let queue = thread.getQueue();
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
    let queue = thread.getQueue();
    queue = Labels.removeNeedsTriagePrefix(queue);
    let newLabel = Labels.addBankruptPrefix(queue);
    await thread.markTriaged(newLabel);
  }

  async addThread(thread: Thread) {
    // Threads with a priority have already been triaged, so don't add them.
    if (thread.getPriority())
      return;

    if (this.vacation_ && (this.vacation_ !== thread.getDisplayableQueue()))
      return;

    if (!this.vacation_ && this.isBestEffortQueue_(thread)) {
      if (this.isBankrupt_(thread)) {
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
    return thread.getDisplayableQueue();
  }

  protected compareThreads(a: Thread, b: Thread) {
    // Sort by queue, then by date.
    if (a.getQueue() == b.getQueue())
      return this.compareDates(a, b);
    return this.queueSettings_.queueNameComparator(a.getQueue(), b.getQueue());
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
        async (fetcher: ThreadFetcher, thread: Thread|null) => {
          if (thread !== null)
            await this.processThread_(thread);
          else
            this.needsFetchThreads_.push(fetcher);
        },
        `(${inInboxNoNeedsTriageLabel}) OR (${hasNeedsTriageLabel}) OR (${
            inUnprocessed})`,
        skipNetwork, maxThreadsToShow);

    this.setThreads(this.pendingThreads_);
    this.pendingThreads_ = [];

    let needsFetchThreads = this.needsFetchThreads_.concat();
    this.needsFetchThreads_ = [];
    await this.doFetches_(needsFetchThreads);

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

  private async doFetches_(threads: ThreadFetcher[]) {
    if (!threads.length)
      return;

    let progress = this.updateTitle(
        'TriageModel.doFetches_', threads.length, 'Updating thread list...');

    for (let bareThread of threads) {
      progress.incrementProgress();
      let thread = await threadCache.get(bareThread);
      assert(thread instanceof Thread);
      await this.processThread_(<Thread>thread, true);
    }
  }

  private async processThread_(thread: Thread, addDirectly?: boolean) {
    let processedId = await this.labels.getId(Labels.PROCESSED_LABEL);
    let messages = thread.getMessages();
    let lastMessage = messages[messages.length - 1];
    let isInInbox = thread.isInInbox();
    let hasUnprocessedLabel =
        thread.getLabelNames().has(Labels.UNPROCESSED_LABEL);

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
