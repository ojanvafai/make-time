import { AbstractThreadListView } from './AbstractThreadListView.js';
import { Actions } from '../Actions.js';
import { fetchThreads } from '../BaseMain.js';
import { Labels } from '../Labels.js';
import { QueueSettings } from '../QueueSettings.js';
import { Thread } from '../Thread.js';
import { MailProcessor } from '../MailProcessor.js';
import { ThreadGroups } from '../ThreadGroups.js';

export class TriageView extends AbstractThreadListView {
  private vacation_ : string;
  private queueSettings_: QueueSettings;

  private static OVERFLOW_ACTIONS_ = [
    Actions.SPAM_ACTION,
  ];

  constructor(threads: ThreadGroups, mailProcessor: MailProcessor, scrollContainer: HTMLElement, allLabels: Labels, vacation: string, updateTitleDelegate: any, setSubject: any, showBackArrow: any, allowedReplyLength: number, contacts: any, autoStartTimer: boolean, timerDuration: number, queueSettings: QueueSettings) {
    let countDown = true;
    super(threads, allLabels, mailProcessor, scrollContainer, updateTitleDelegate, setSubject, showBackArrow, allowedReplyLength, contacts, autoStartTimer, countDown, timerDuration, TriageView.OVERFLOW_ACTIONS_);
    this.vacation_ = vacation;
    this.queueSettings_ = queueSettings;
    this.appendButton('/todo', `Go to todo list`);
  }

  handleUndo(_thread: Thread) {
  }

  handleTriaged(_destination: string | null, _thread: Thread) {
  }

  async addThread(thread: Thread) {
    let priority = await thread.getPriority();
    // Threads with a priority have already been triaged, so don't add them.
    if (priority)
      return;

    // Threads that have triage labels but aren't in the inbox were archived outside
    // of maketime and should have their triage labels removed.
    if (!(await thread.isInInbox())) {
      await thread.markTriaged(null);
      return;
    }

    if (this.vacation_ && (this.vacation_ !== (await thread.getDisplayableQueue())))
      return;

    super.addThread(thread);
  }

  // TODO: Store the list of threads in localStorage and update asynchronously.
  async fetch(shouldBatch?: boolean) {
    this.updateTitle('fetch', ' ');

    let labels = await this.allLabels.getThreadCountForLabels((label: string) => {
      return this.vacation_ ? label == Labels.needsTriageLabel(this.vacation_) : Labels.isNeedsTriageLabel(label);
    });
    let labelsToFetch = labels.filter(data => data.count).map(data => data.name);
    labelsToFetch = this.queueSettings_.getSorted(labelsToFetch).map((item) => item[0]);

    this.clearBestEffort();

    let makeTimeLabels = this.allLabels.getMakeTimeLabelNames().filter((item) => item != Labels.PROCESSED_LABEL);

    // Put threads that are in the inbox with no make-time labels first. That way they always show up before
    // daily/weekly/monthly bundles for folks that don't want to filter 100% of their mail with make-time.
    await fetchThreads(this.processThread.bind(this), {
      query: `in:inbox -(in:${makeTimeLabels.join(' OR in:')})`,
    });

    await this.fetchLabels(labelsToFetch, shouldBatch);
    this.updateTitle('fetch');
  }

  compareRowGroups(a: any, b: any) {
    return this.queueSettings_.queueNameComparator(a.queue, b.queue);
  }

  async getDisplayableQueue(thread: Thread) {
    return await thread.getDisplayableQueue();
  }

  async getQueue(thread: Thread) {
    return thread.getQueue();
  }
}
window.customElements.define('mt-triage-view', TriageView);
