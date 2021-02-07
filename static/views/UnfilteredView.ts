import { Action, ActionGroup, registerActions } from '../Actions.js';
import { assert, create, createMktimeButton, defined, Labels, parseAddressList } from '../Base.js';
import { Dialog } from '../Dialog.js';
import { MailProcessor } from '../MailProcessor.js';
import { ThreadListModel } from '../models/ThreadListModel.js';
import { QueueNames } from '../QueueNames.js';
import { FilterRule, HeaderFilterRule, Settings } from '../Settings.js';
import { UpdatedEvent } from '../Thread.js';
import { ARCHIVE_ACTIONS } from '../ThreadActions.js';

import { AppShell } from './AppShell.js';
import { FilterRuleComponent, LabelCreatedEvent } from './FilterRuleComponent.js';
import {
  NEXT_ACTION,
  PREVIOUS_ACTION,
  ThreadListViewBase,
  VIEW_IN_GMAIL_ACTION,
  VIEW_THREADLIST_ACTION,
} from './ThreadListViewBase.js';
import { RenderThreadEvent, ThreadRow } from './ThreadRow.js';
import { SelectRowEvent, ThreadRowGroup, ThreadRowGroupRenderMode } from './ThreadRowGroup.js';

let ADD_FILTER_ACTION = {
  name: `Add filter`,
  description: `Adds the filter rule above with a label you choose.`,
  key: 'f',
  actionGroup: ActionGroup.Filter,
};

let FILTER_TOOLBAR = [
  ...ARCHIVE_ACTIONS,
  ADD_FILTER_ACTION,
  NEXT_ACTION,
  PREVIOUS_ACTION,
  VIEW_THREADLIST_ACTION,
  VIEW_IN_GMAIL_ACTION,
];

registerActions('Unfiltered', FILTER_TOOLBAR);

export class UnfilteredView extends ThreadListViewBase {
  private rowGroup_: ThreadRowGroup;
  private renderedThreadContainer_: HTMLElement;
  private focusedRow_?: ThreadRow;
  private filterRuleComponent_?: FilterRuleComponent;
  private helpText_: HTMLElement;
  private shouldRenderFocusedRowMessages_!: boolean;

  // Use - as a heuristic for rare headers the user is unlikely to want.
  private static HEADER_FILTER_MENU_EXCLUDES_ = [
    '-',
    'received',
    'precedence',
    'date',
    'references',
  ];
  private static HEADER_FILTER_MENU_INCLUDES_ = ['list-id'];
  // Fields that contain email addresses and are handled specially by
  // MailProcessor need to inject different filter values.
  private static TO_EMAIL_HEADERS_ = ['to', 'cc', 'bcc'];
  private static FROM_EMAIL_HEADERS_ = ['from'];
  private static EMAIL_ADDRESS_HEADERS_ = [
    ...UnfilteredView.TO_EMAIL_HEADERS_,
    ...UnfilteredView.FROM_EMAIL_HEADERS_,
    'sender',
  ];
  private static MKTIME_CUSTOM_FILTER_DIRECTIVES_: (
    | 'label'
    | 'subject'
    | 'plaintext'
    | 'htmlcontent'
  )[] = ['label', 'subject', 'plaintext', 'htmlcontent'];
  constructor(
    model: ThreadListModel,
    appShell: AppShell,
    settings: Settings,
    private getMailProcessor_?: () => Promise<MailProcessor>,
  ) {
    super(model, appShell, settings);

    this.shouldRenderFocusedRowMessages_ = false;

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width margin-auto relative';
    this.rowGroup_ = new ThreadRowGroup(
      Labels.Fallback,
      0,
      ThreadRowGroupRenderMode.UnfilteredStyle,
    );
    this.rowGroup_.style.backgroundColor = 'var(--nested-background-color)';

    // TODO: Do viewport handling for when there are many unfiltered.
    this.rowGroup_.setInViewport(true);
    this.append(this.rowGroup_, this.renderedThreadContainer_);

    this.listen(this.rowGroup_, RenderThreadEvent.NAME, (e: Event) => {
      this.setShouldRenderFocusedRowMessages_(true);
      const row = e.target as ThreadRow;
      this.setFocusedRow_(row);
      this.renderRowMessages_(row);
    });

    this.listen(this.rowGroup_, SelectRowEvent.NAME, (e: Event) => {
      this.setFocusedRow_(e.target as ThreadRow);
    });

    this.helpText_ = document.createElement('div');
    this.helpText_.className = 'text-size-small center theme-dim-text-color mx1-and-half';
    this.helpText_.append(
      `Add a filter rule to label this and future messages. You can edit it later from Settings.`,
    );

    this.displayHelpText_();
    this.render();
  }

  private displayHelpText_() {
    this.appShell.setSubject(this.helpText_);
  }

  protected getGroups() {
    return [this.rowGroup_];
  }

  openFirstSelectedThreadInGmail_() {
    // Would prefer to open all the selected rows in gmail, but Chrome only
    // allows one popup per gesture.
    if (!this.focusedRow_) return;
    this.openThreadInGmail(this.focusedRow_.thread);
  }

  private createLabelPicker_(labels: string[], callback: (e: Event) => void) {
    const labelPicker = document.createElement('div');
    labelPicker.className = 'mx-half flex-expand-1 flex flex-wrap justify-center';
    for (const label of labels) {
      labelPicker.append(createMktimeButton(callback, label));
    }
    return labelPicker;
  }

  private async promptForLabel_() {
    const labels = await this.settings.getSortedLabels();
    return new Promise((resolve: (label?: string) => void) => {
      let selectedLabel: string | undefined;
      const selectLabel = (e: Event) => {
        selectedLabel = (e.target as HTMLElement).textContent;
        dialog.remove();
      };

      const builtInLabels = Object.values(Labels).filter((x) => x !== Labels.Fallback) as string[];
      const customLabels = labels.filter((x) => !builtInLabels.includes(x));

      const labelPicker = this.createLabelPicker_(customLabels, selectLabel);
      const builtInLabelPicker = this.createLabelPicker_(builtInLabels, selectLabel);

      let createNewLabelButton = createMktimeButton(() => {
        const queueNames = QueueNames.create();
        selectedLabel = queueNames.promptForNewLabel();
        if (selectedLabel) {
          this.settings.addLabel(selectedLabel);
        }
        dialog.remove();
      }, 'create new label');

      builtInLabelPicker.append(createNewLabelButton);

      const customLabelsTitle = create('div', 'Custom labels');
      customLabelsTitle.style.marginTop = '12px';

      const dialogContents = document.createElement('div');
      dialogContents.style.cssText = `
        display: flex;
        flex-direction: column;
        align-items: center;
        overflow: auto;
      `;
      dialogContents.append(
        create('div', 'Which label should this filter rule apply?'),
        builtInLabelPicker,
        customLabelsTitle,
        labelPicker,
      );

      let cancelButton = createMktimeButton(() => dialog.remove(), 'cancel');
      const dialog = new Dialog(dialogContents, [cancelButton]);
      dialog.style.margin = '32px auto';
      dialog.style.maxWidth = '450px';
      dialog.addEventListener('close', () => {
        resolve(selectedLabel);
      });
    });
  }

  private ruleJsonsMatch_(a: FilterRule, b: FilterRule) {
    for (let directive of UnfilteredView.MKTIME_CUSTOM_FILTER_DIRECTIVES_) {
      if (a[directive] !== b[directive]) {
        return false;
      }
    }

    // Both need to either have headers or both not.
    const aCount = a.header ? a.header.length : 0;
    const bCount = b.header ? b.header.length : 0;
    if (aCount !== bCount) {
      return false;
    }
    if (!a.header || !b.header) {
      return true;
    }

    const sortByNBame = (a: HeaderFilterRule, b: HeaderFilterRule) => {
      if (a.name < b.name) return -1;
      if (b.name < a.name) return 1;
      return 0;
    };
    let aHeaderRules = a.header.sort(sortByNBame);
    let bHeaderRules = b.header.sort(sortByNBame);

    for (let i = 0; i < aHeaderRules.length; i++) {
      const aRule = aHeaderRules[i];
      const bRule = bHeaderRules[i];
      if (aRule.name !== bRule.name || aRule.value !== bRule.value) {
        return false;
      }
    }
    return true;
  }

  private mergeFilterRule_(existingFilterRules: FilterRule[], ruleJson: FilterRule) {
    const appendedVersion = [...existingFilterRules, ruleJson];

    for (let i = existingFilterRules.length - 1; i >= 0; i--) {
      // We can merge filter rules if they only differ on one directive and that
      // directive is one that takes comma separated lists.
      const currentRuleJson = existingFilterRules[i];
      if (
        ruleJson.label !== currentRuleJson.label ||
        ruleJson.matchallmessages !== currentRuleJson.matchallmessages ||
        ruleJson.nolistid !== currentRuleJson.nolistid ||
        ruleJson.nocc !== currentRuleJson.nocc
      ) {
        continue;
      }

      // Can only merge from and to since those are the only CSV directives.
      let differsOnFrom = ruleJson.from !== currentRuleJson.from;
      let differsOnTo = ruleJson.to !== currentRuleJson.to;
      if ((differsOnFrom && differsOnTo) || !this.ruleJsonsMatch_(ruleJson, currentRuleJson)) {
        continue;
      }
      if (differsOnTo) {
        currentRuleJson.to += `,${ruleJson.to}`;
      } else if (differsOnFrom) {
        currentRuleJson.from += `,${ruleJson.from}`;
      }
      // If !differsOnTo && !differsOnFrom, then this rule is identical to an
      // existing one and there's nothing to do.
      return existingFilterRules;
    }

    // If there's no spot to merge the rule, append it to the end.
    return appendedVersion;
  }

  private async saveFilterRule_() {
    // Save this off before any awaits to avoid races using it later
    const focusedRow = defined(this.focusedRow_);
    const thread = focusedRow.thread;
    const ruleJson = defined(this.filterRuleComponent_).getJson();
    if (!ruleJson) {
      // We should already have shown the user an alert here since this
      // happens when they use an invalid field.
      return;
    }
    const newLabel = await this.promptForLabel_();
    if (!newLabel) {
      return;
    }
    ruleJson.label = newLabel;

    const mailProcessor = await defined(this.getMailProcessor_)();
    const ruleMatches = await mailProcessor.ruleMatchesMessages(ruleJson, thread.getMessages());
    if (!ruleMatches) {
      alert("This filter rule doesn't match the current thread.");
      return;
    }

    this.disableActionToolbar();
    const existingFilterRules = await this.settings.getFilters();
    await this.settings.writeFilters(this.mergeFilterRule_(existingFilterRules, ruleJson));

    const rowsToFilter = [];
    for (const row of this.getRows()) {
      const rowMatchesNewFilterRule = await mailProcessor.ruleMatchesMessages(
        ruleJson,
        row.thread.getMessages(),
      );

      if (rowMatchesNewFilterRule) {
        rowsToFilter.push(row);
        row.thread.setActionInProgress(true);
      }
    }

    this.applyFilters_(rowsToFilter);
  }

  private async applyFilters_(rowsToFilter: ThreadRow[]) {
    const mailProcessor = await defined(this.getMailProcessor_)();
    for (const row of rowsToFilter) {
      await mailProcessor.applyFilters(row.thread);
    }
  }

  private updateFilterToolbar_(row: ThreadRow) {
    this.setActions(FILTER_TOOLBAR);
    const messages = row.thread.getMessages();
    if (messages.length) {
      this.populateFilterToolbar_(row);
    } else {
      // If a thread is still loading, then we have to wait for it's messages
      // to load in order to be able to setup the filter toolbar.
      row.thread.addEventListener(UpdatedEvent.NAME, () => this.populateFilterToolbar_(row), {
        once: true,
      });
    }
  }

  private populateFilterToolbar_(row: ThreadRow) {
    // Prefill the rule with the first sender of the first message.
    const firstMessage = row.thread.getMessages()[0];
    const rule = { from: firstMessage.parsedFrom[0].address };
    const filterRuleComponent = new FilterRuleComponent(this.settings, rule, true);
    filterRuleComponent.classList.add('m-half');
    filterRuleComponent.addEventListener(LabelCreatedEvent.NAME, (e) => {
      const labelOption = (e as LabelCreatedEvent).labelOption;
      filterRuleComponent.prependLabel(labelOption.cloneNode(true) as HTMLOptionElement);
    });
    this.filterRuleComponent_ = filterRuleComponent;

    const headerMenu = document.createElement('div');
    headerMenu.className = 'overflow-auto';
    headerMenu.style.maxHeight = '15vh';

    const headers = firstMessage.getHeaders();
    headers.sort((a, b) => {
      if (a < b) return -1;
      if (a > b) return 1;
      return 0;
    });

    for (const header of headers) {
      if (!header.value) {
        continue;
      }

      const name = header.name ?? '';
      const lowercaseName = name.toLowerCase();

      let value = header.value;
      if (UnfilteredView.EMAIL_ADDRESS_HEADERS_.some((x) => lowercaseName.includes(x))) {
        value = parseAddressList(value)[0].address;
      }

      const container = document.createElement('label');
      container.className = 'truncate flex items-center m-half flex-expand-1 ';
      const nameContainer = document.createElement('b');
      nameContainer.append(`${name}:`);
      nameContainer.style.marginRight = '4px';

      let directiveName: string;
      if (UnfilteredView.TO_EMAIL_HEADERS_.includes(lowercaseName)) {
        directiveName = 'to';
      } else if (UnfilteredView.FROM_EMAIL_HEADERS_.includes(lowercaseName)) {
        directiveName = 'from';
      } else {
        directiveName = `$${lowercaseName}`;
      }

      // Extract out the actual list-id from the header. List-ids are of the
      // form "List name"<list.id.com> where the quoted part is optional.
      if (lowercaseName === 'list-id') {
        let match = value.match(/<([^>]+)>$/);
        if (match) value = match[1];
      }

      const addButton = create('span', '+');
      addButton.classList.add('row-button');
      addButton.setAttribute('title', 'Add to filter rule');
      addButton.onclick = () => {
        filterRuleComponent.add(directiveName, value);
      };

      const minusButton = create('span', '-');
      minusButton.classList.add('row-button');
      minusButton.setAttribute('title', 'Remove from filter rule');
      minusButton.onclick = () => {
        filterRuleComponent.delete(directiveName);
      };

      container.append(addButton, minusButton, nameContainer, value);

      if (
        UnfilteredView.HEADER_FILTER_MENU_INCLUDES_.some((x) => lowercaseName.includes(x)) ||
        !UnfilteredView.HEADER_FILTER_MENU_EXCLUDES_.some((x) => lowercaseName.includes(x))
      ) {
        headerMenu.append(container);
      }
    }

    let container = document.createElement('div');
    container.className = 'flex flex-column justify-center fill-available-width';
    container.append(filterRuleComponent, headerMenu);
    AppShell.addToFooter(container);
  }

  async goBack() {
    this.setShouldRenderFocusedRowMessages_(false);
  }

  private setShouldRenderFocusedRowMessages_(shouldRender: boolean) {
    this.shouldRenderFocusedRowMessages_ = shouldRender;

    if (!shouldRender) {
      this.displayHelpText_();
    }

    this.appShell.showBackArrow(shouldRender);
    this.rowGroup_.style.display = shouldRender ? 'none' : 'block';
    this.renderedThreadContainer_.style.display = shouldRender ? 'block' : 'none';
  }

  private setFocusedRow_(row: ThreadRow) {
    if (this.focusedRow_ === row) {
      return;
    }

    if (this.focusedRow_) {
      this.focusedRow_.setCheckedAndFocus(false);
      this.focusedRow_.rendered.remove();
    }

    this.focusedRow_ = row;
    row.setCheckedAndFocus(true);

    if (this.shouldRenderFocusedRowMessages_) {
      this.renderRowMessages_(row);
    }
    this.updateFilterToolbar_(this.focusedRow_);
  }

  private renderRowMessages_(row: ThreadRow) {
    this.appShell.showBackArrow(true);
    this.setThreadSubject(assert(row).thread);

    let rendered = row.rendered;
    assert(
      !rendered.isAttached() || rendered.parentNode === this.renderedThreadContainer_,
      'Tried to rerender already rendered thread. This should never happen.',
    );
    if (!rendered.isAttached()) {
      rendered.render();
      this.renderedThreadContainer_.append(rendered);
    }
    rendered.style.bottom = '';
    rendered.style.visibility = 'visible';

    // Do this async so it doesn't block putting up the frame.
    setTimeout(() => this.prerender_());
  }

  protected renderFrame() {
    const oldRows = this.getRows();
    const rows = [];
    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => !x.actionInProgress());
    for (let thread of threads) {
      // Skip already triaged threads with the unfiltered label.
      if (!thread.forceTriage() || this.mergedGroupName(thread) !== Labels.Fallback) {
        continue;
      }
      rows.push(this.getThreadRow(thread));
    }

    if (!rows.length) {
      this.routeToTodo_();
      return;
    }

    const rowsRemoved = this.rowGroup_.setRows(rows);
    if (this.focusedRow_) {
      if (rowsRemoved.includes(this.focusedRow_)) {
        // Focus the next row after the removed focused row or the last row if
        // there aren't any.
        const oldIndex = oldRows.indexOf(this.focusedRow_);
        let newFocus = oldRows.slice(oldIndex + 1).find((x) => !rowsRemoved.includes(x));
        this.setFocusedRow_(newFocus || rows[rows.length - 1]);
      }
    } else {
      this.setFocusedRow_(rows[0]);
    }
    // Do this async so it doesn't block putting up the frame.
    setTimeout(() => this.prerender_());
  }

  private prerender_() {
    let row;
    if (this.shouldRenderFocusedRowMessages_) {
      row = assert(this.focusedRow_).nextSibling as ThreadRow;
    } else {
      row = this.focusedRow_;
    }

    if (!row) return;

    let rendered = row.rendered;
    rendered.render();
    rendered.style.position = 'absolute';
    rendered.style.bottom = '0';
    rendered.style.visibility = 'hidden';
    this.renderedThreadContainer_.append(rendered);
  }

  private routeToTodo_() {
    let a = document.createElement('a');
    a.append(name);
    a.href = '/todo';
    this.append(a);
    a.click();
  }

  async takeAction(action: Action) {
    switch (action) {
      case ADD_FILTER_ACTION:
        await this.saveFilterRule_();
        return;

      case NEXT_ACTION:
      case PREVIOUS_ACTION:
        const focused = defined(this.focusedRow_);
        const next =
          action === NEXT_ACTION ? focused.nextElementSibling : focused.previousElementSibling;
        if (next) {
          this.setFocusedRow_(next as ThreadRow);
        }
        break;

      case VIEW_IN_GMAIL_ACTION:
        this.openFirstSelectedThreadInGmail_();
        return;

      case VIEW_THREADLIST_ACTION:
        this.setShouldRenderFocusedRowMessages_(false);
        return;

      default:
        await this.model.markTriaged(action, [assert(this.focusedRow_).thread]);
    }
  }
}
window.customElements.define('mt-unfiltered-view', UnfilteredView);
