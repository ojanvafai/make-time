import { Action, ActionGroup, registerActions, ActionList } from '../Actions.js';
import { assert, create, createMktimeButton, defined, Labels, parseAddressList } from '../Base.js';
import { Dialog } from '../Dialog.js';
import { MailProcessor } from '../MailProcessor.js';
import { ThreadListModel } from '../models/ThreadListModel.js';
import { QueueNames } from '../QueueNames.js';
import { RenderedCard } from '../RenderedCard.js';
import { FilterRule, HeaderFilterRule, Settings } from '../Settings.js';
import { Thread } from '../Thread.js';
import {
  UNTRIAGED_ARCHIVE_ACTION,
  UNTRIAGED_MUST_DO_ACTION,
  UNTRIAGED_STUCK_1D_ACTION,
  UNTRIAGED_PIN_ACTION,
} from '../ThreadActions.js';

import { AppShell } from './AppShell.js';
import { FilterRuleComponent, LabelCreatedEvent } from './FilterRuleComponent.js';
import {
  ThreadListViewBase,
  VIEW_IN_GMAIL_ACTION,
  OTHER_MENU_ACTION,
} from './ThreadListViewBase.js';

let UNDO_ACTION = {
  name: `Undo`,
  description: `Undoes the last action taken.`,
  key: 'u',
  actionGroup: ActionGroup.Other,
};

let ADD_FILTER_ACTION = {
  name: `Filter`,
  description: `Add a new filter rule for this thread.`,
  key: 'f',
  actionGroup: ActionGroup.Other,
};

const HAS_CURRENT_CARD_TOOLBAR = [
  UNTRIAGED_ARCHIVE_ACTION,
  UNTRIAGED_PIN_ACTION,
  UNTRIAGED_MUST_DO_ACTION,
  UNTRIAGED_STUCK_1D_ACTION,
  VIEW_IN_GMAIL_ACTION,
];

registerActions('Untriaged', [...HAS_CURRENT_CARD_TOOLBAR, UNDO_ACTION, ADD_FILTER_ACTION]);

const CENTERED_FILL_CONTAINER_CLASS = 'absolute all-0 flex items-center justify-center';

// Use - as a heuristic for rare headers the user is unlikely to want.
const HEADER_FILTER_MENU_EXCLUDES = ['-', 'received', 'precedence', 'date', 'references'];
const HEADER_FILTER_MENU_INCLUDES = ['list-id'];
// Fields that contain email addresses and are handled specially by
// MailProcessor need to inject different filter values.
const TO_EMAIL_HEADERS = ['to', 'cc', 'bcc'];
const FROM_EMAIL_HEADERS = ['from'];
const EMAIL_ADDRESS_HEADERS = [...TO_EMAIL_HEADERS, ...FROM_EMAIL_HEADERS, 'sender'];
const MKTIME_CUSTOM_FILTER_DIRECTIVES: ('label' | 'subject' | 'plaintext' | 'htmlcontent')[] = [
  'label',
  'subject',
  'plaintext',
  'htmlcontent',
];

export class UntriagedView extends ThreadListViewBase {
  private renderedThreadContainer_: HTMLElement;
  private currentCard_?: RenderedCard;
  private threadAlreadyTriagedDialog_?: HTMLElement;
  private filterRuleComponent_?: FilterRuleComponent;
  private filterSaveButton_?: HTMLButtonElement;

  constructor(
    model: ThreadListModel,
    appShell: AppShell,
    settings: Settings,
    private getMailProcessor_: () => Promise<MailProcessor>,
  ) {
    super(model, appShell, settings);

    this.renderedThreadContainer_ = document.createElement('div');
    this.renderedThreadContainer_.className = 'theme-max-width mx-auto absolute all-0';
    this.append(this.renderedThreadContainer_);

    this.render();
  }

  protected getGroups() {
    return [];
  }

  private updateViewContents_(element: HTMLElement) {
    this.clearAlreadyTriagedThreadState_();
    this.renderedThreadContainer_.textContent = '';
    this.renderedThreadContainer_.append(element);
  }

  private updateToolbar_() {
    let actions: ActionList = [];
    const otherMenuActions = [];

    if (this.currentCard_) {
      actions = [...HAS_CURRENT_CARD_TOOLBAR];
      if (this.currentCard_.thread.getLabel() === Labels.Fallback) {
        otherMenuActions.push(ADD_FILTER_ACTION);
      }
    }
    if (this.model.hasUndoActions()) {
      otherMenuActions.push(UNDO_ACTION);
    }

    if (otherMenuActions.length === 1) {
      actions.push(otherMenuActions[0]);
    } else if (otherMenuActions.length > 1) {
      actions.push([OTHER_MENU_ACTION, otherMenuActions]);
    }
    this.setActions(actions);
  }

  protected async renderFrame() {
    if (!this.model.hasFetchedThreads()) {
      return;
    }

    const allThreads = this.model.getThreads(true);
    let threads = allThreads.filter((x) => x.forceTriage() && !x.actionInProgress());

    if (!threads.length) {
      this.clearCurrentCard_();

      const contents = document.createElement('div');
      contents.className = `${CENTERED_FILL_CONTAINER_CLASS} theme-text-color p1 center mx-auto pre-wrap`;
      contents.style.maxWidth = '250px';
      contents.append('All done triaging.\n\nPress any key or click anywhere to go to todo view.');
      contents.onclick = () => this.routeToTodo_();
      this.updateViewContents_(contents);
      this.updateToolbar_();
      return;
    }

    // TODO: Render the top N card shells so it looks like a stack of cards.
    // TODO: Prerender the next card's message contents
    // TODO: Make swiping the cards work on mobile and with two fingers on desktop trackpad.
    if (!this.currentCard_) {
      const thread = threads[0];
      const labelSelectTemplate = await this.settings.getLabelSelectTemplate();
      this.currentCard_ = new RenderedCard(thread, labelSelectTemplate);
      this.updateViewContents_(this.currentCard_);
      await this.currentCard_.render();
      this.updateToolbar_();
    } else if (!threads.includes(this.currentCard_.thread) && !this.threadAlreadyTriagedDialog_) {
      this.threadAlreadyTriagedDialog_ = document.createElement('div');
      const contents = document.createElement('div');
      contents.className =
        'overlay-background-color overlay-border-and-shadow theme-text-color p2 m4 center flex flex-column';
      contents.append(
        'This thread has already been triaged elsewhere. Press any key to go to next thread.',
        createMktimeButton(() => this.clearAlreadyTriagedThreadState_(), 'Go to next thread'),
      );
      this.threadAlreadyTriagedDialog_.append(contents);
      this.threadAlreadyTriagedDialog_.className = `${CENTERED_FILL_CONTAINER_CLASS} darken2`;
      this.renderedThreadContainer_.append(this.threadAlreadyTriagedDialog_);
      this.updateToolbar_();
    }
  }

  private routeToTodo_() {
    let a = document.createElement('a');
    a.href = '/todo';
    this.append(a);
    a.click();
  }

  private clearCurrentCard_() {
    this.currentCard_ = undefined;
  }

  private clearAlreadyTriagedThreadState_() {
    if (!this.threadAlreadyTriagedDialog_) {
      return false;
    }
    defined(this.threadAlreadyTriagedDialog_).remove();
    this.threadAlreadyTriagedDialog_ = undefined;
    this.clearCurrentCard_();
    this.render();
    return true;
  }

  async dispatchShortcut(e: KeyboardEvent) {
    if (await super.dispatchShortcut(e)) {
      return true;
    }
    // This is after the dispatchShortcut in case the user does an undo action.
    if (this.clearAlreadyTriagedThreadState_()) {
      return true;
    }
    if (!this.currentCard_) {
      this.routeToTodo_();
    }
    return true;
  }

  async takeAction(action: Action) {
    // The toolbar should be disabled when this dialog is up.
    assert(!this.threadAlreadyTriagedDialog_);

    switch (action) {
      case ADD_FILTER_ACTION:
        this.populateFilterToolbar_(assert(this.currentCard_).thread);
        return true;

      case UNDO_ACTION:
        this.clearCurrentCard_();
        this.model.undoLastAction();
        return true;

      case VIEW_IN_GMAIL_ACTION:
        if (this.currentCard_) {
          this.openThreadInGmail(this.currentCard_.thread);
        }
        return true;

      default:
        const thread = assert(this.currentCard_).thread;
        this.clearCurrentCard_();
        // TODO: Have the triage action animate the card off the screen
        return await this.model.markTriaged(action, [thread]);
    }
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

  private async saveFilterRule_() {
    // Save this off before any awaits to avoid races using it later
    const focusedRow = defined(this.currentCard_);
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

    const saveButton = assert(this.filterSaveButton_);
    saveButton.textContent = 'Saving filter...';
    saveButton.disabled = true;

    try {
      const existingFilterRules = await this.settings.getFilters();
      await this.settings.writeFilters(this.mergeFilterRule_(existingFilterRules, ruleJson));
      console.log('applyFiltered');
      await mailProcessor.applyFilters(thread);
      console.log('done applyFiltered');
      this.updateToolbar_();
      console.log('updateToolbar');
    } catch (e) {
      saveButton.textContent = 'Retry saving filter';
      saveButton.disabled = false;
    }
  }

  private ruleJsonsMatch_(a: FilterRule, b: FilterRule) {
    for (let directive of MKTIME_CUSTOM_FILTER_DIRECTIVES) {
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

  private populateFilterToolbar_(thread: Thread) {
    // Prefill the rule with the first sender of the first message.
    const firstMessage = thread.getMessages()[0];
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
      if (EMAIL_ADDRESS_HEADERS.some((x) => lowercaseName.includes(x))) {
        value = parseAddressList(value)[0].address;
      }

      const container = document.createElement('label');
      container.className = 'truncate flex items-center m-half flex-expand-1 ';
      const nameContainer = document.createElement('b');
      nameContainer.append(`${name}:`);
      nameContainer.style.marginRight = '4px';

      let directiveName: string;
      if (TO_EMAIL_HEADERS.includes(lowercaseName)) {
        directiveName = 'to';
      } else if (FROM_EMAIL_HEADERS.includes(lowercaseName)) {
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
        HEADER_FILTER_MENU_INCLUDES.some((x) => lowercaseName.includes(x)) ||
        !HEADER_FILTER_MENU_EXCLUDES.some((x) => lowercaseName.includes(x))
      ) {
        headerMenu.append(container);
      }
    }

    this.filterSaveButton_ = createMktimeButton(
      () => this.saveFilterRule_(),
      'Save and apply filter',
    );

    let container = document.createElement('div');
    container.className = 'flex flex-column justify-center fill-available-width p1';
    container.append(
      this.smallText_('Configure the filter below and then click the save button'),
      filterRuleComponent,
      this.filterSaveButton_,
      this.smallText_('(Optional) use the buttons below to build the filter rule you want'),
      headerMenu,
    );
    AppShell.addToFooter(container);
  }

  private smallText_(text: string) {
    const div = document.createElement('div');
    div.className = 'small quiet m-half center';
    div.append(text);
    return div;
  }
}
window.customElements.define('mt-untriaged-view', UntriagedView);
