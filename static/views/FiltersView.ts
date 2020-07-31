import {create, createMktimeButton, defined, Labels} from '../Base.js';
import {Dialog} from '../Dialog.js';
import {FilterRule, Settings} from '../Settings.js';

import {FilterRuleComponent, LabelCreatedEvent} from './FilterRuleComponent.js';
import {HelpDialog} from './HelpDialog.js';

export const HELP_TEXT = [
  create('b', 'Help'),
  `
Every thread has exactly one filter that applies to it (i.e. gets exactly one label). The filter can apply a label, or archive it (put "${
      Labels
          .Archive}" as the label). This is achieved by having filters be first one wins instead of gmail's filtering where all filters apply. A nice side effect of this is that you can do richer filtering by taking advantage of ordering, e.g. I can have emails to me from my team show up in my inbox immediately, but emails to me from others only show up once a day.

 - Directives separated by "&&" must all apply in order for the rule to match. There is currently no "OR" value and no "NOT" value (patches welcome!).
 - "${
      Labels
          .Archive}" is a special label that removes the unprocessed label from a message, but does not put it in the inbox.
 - Use ctrl+up/down or cmd+up/down to reorder the focused row. Hold shift to move 10 rows at a time.
 - The first rule that matches is the one that applies, so order matters.
 - Label is the label that will apply qhen the rule matches.
 - Rule is the rule to match.
 - Match All Messages will required the rule to match all the messages in the thread to be considered a match. Otherwise, any message in the thread matching will mean the whole thread matches.
 - No List-ID matches messages that are not sent to an email list.
 - No CCs matches messages that have exactly one email address in the union of the to/cc/bcc fields.
 - Make-time matches all messages in the thread each time the thread is processed, unlike gmail filters which only match the new message.
 - If none of your filters apply to a thread, then make-time will apply a "${
      Labels
          .Fallback}" label. This lets you ensure all mail gets appropriate filters, e.g. when you sign up for a new mailing list, they'll go here until you add a filter rule for the list.

`,
  create('b', 'Rule directives'), `
 - `,
  create('b', '$anything:'),
  ` Matches the raw email header "anything". So, $from matches the From header as plain text instead of the structure match that "from:" below does. You can view raw email headers in gmail by going to a message and opening "Show Original" from the "..." menu.
 - `,
  create('b', 'to:'),
  ` Matches the to/cc/bcc fields of the email. It just checks if the name or email address includes the value. Take a comma separated list of values so you don't have to make a different rule for each address you want to match.
 - `,
  create('b', 'from:'),
  ` Matches the from field of the email. Same matching rules as the "to" directive.
 - `,
  create('b', 'subject:'),
  ` Matches if the subject of the email includes this text.
 - `,
  create('b', 'plaintext:'),
  ` Matches if the plain text of the email includes this text.
 - `,
  create('b', 'htmlcontent:'),
  ` Matches if the HTML of the email includes this text.
 - All rules are case insensitive and can be done as regular expressions by prefixing the value with regexp:, so from:regexp:foo will do a regexp on the from field with the value "foo".
`
];

export class FiltersView extends HTMLElement {
  private dialog_?: Dialog;

  private static ROW_CLASSNAME_ = 'filter-rule-row';

  constructor(private settings_: Settings) {
    super();
    this.style.cssText = `
      display: flex;
      flex-direction: column;
      width: 800px;
      max-width: 95vw;
    `;

    this.addEventListener('keydown', e => this.handleKeyDown_(e));
    this.addEventListener(
        LabelCreatedEvent.NAME,
        e => {this.handleLabelCreated_((e as LabelCreatedEvent).labelOption)});
    this.render_();
  }

  private handleLabelCreated_(labelOption: HTMLOptionElement) {
    const filterRuleComponents = this.getFilterRuleComponents_();
    for (let rule of filterRuleComponents) {
      rule.prependLabel(labelOption.cloneNode(true) as HTMLOptionElement);
    }
  }

  handleKeyDown_(e: KeyboardEvent) {
    // TODO: Use metaKey on mac and ctrlKey elsewhere.
    let hasModifier = e.ctrlKey || e.metaKey;
    if (!hasModifier)
      return;

    switch (e.key) {
      case 'ArrowUp':
        this.moveFocusedRow_(e.key, e.shiftKey);
        break;

      case 'ArrowDown':
        this.moveFocusedRow_(e.key, e.shiftKey);
        break;
    }
  }

  private moveFocusedRow_(direction: string, move10: boolean) {
    // TODO: Put a proper type on this.
    let focused = <any>document.activeElement;

    let row = focused.parentElement;
    while (row && !row.classList.contains(FiltersView.ROW_CLASSNAME_)) {
      row = row.parentElement;
    }
    if (!row)
      return;

    let parent = row.parentElement;
    while (parent && parent != this) {
      parent = parent.parentElement;
    }
    if (!parent) {
      return;
    }

    this.moveRow_(parent, direction, move10);
    focused.focus();
  }

  private moveRow_(row: HTMLElement, direction: string, move10: boolean) {
    let count = move10 ? 10 : 1;

    if (direction == 'ArrowUp') {
      while (count-- && row.previousSibling) {
        row.previousSibling.before(row);
      }
    } else if (direction == 'ArrowDown') {
      while (count-- && row.nextSibling) {
        row.nextSibling.after(row);
      }
    } else {
      throw `Tried to move row in invalid direction: ${direction}`;
    }
  }

  async render_() {
    let rules = await this.settings_.getFilters();

    let container = document.createElement('div');
    container.style.cssText = `font-size: 13px;`;

    for (let rule of rules) {
      container.append(await this.createRule_(rule));
    }

    // Ensure there's at least one row since there's no other way to add the
    // first row.
    if (!rules.length)
      container.append(await this.createRule_({}));

    let scrollable = document.createElement('div');
    scrollable.style.cssText = `
      overflow: auto;
      flex: 1;
    `;
    scrollable.append(container, this.createUnfileredRule_());
    this.append(scrollable);

    let helpButton =
        createMktimeButton(() => new HelpDialog(...HELP_TEXT), 'Help');
    helpButton.style.cssText = `margin-right: auto`;
    let cancel = createMktimeButton(() => this.cancel_(), 'cancel');
    let save = createMktimeButton(() => this.save_(), 'save');
    this.dialog_ = new Dialog(this, [helpButton, cancel, save]);
  }

  createUnfileredRule_() {
    let row = document.createElement('div');
    row.style.cssText = `
      display: flex;
      align-items: center;
    `;
    const addButton = this.createButton_('+', 'Add new row above', async () => {
      let emptyRule = await this.createRule_({});
      row.before(emptyRule);
    });
    addButton.style.marginRight = '16px';
    row.append(
        addButton,
        `The "${Labels.Fallback}" label is applied when no filters match.`);
    return row;
  }

  private getFilterRuleComponents_() {
    return this.querySelectorAll('mt-filter-rule') as
        NodeListOf<FilterRuleComponent>;
  }

  async save_() {
    let filterRuleComponents = this.getFilterRuleComponents_();
    let rules: FilterRule[] = [];
    for (let filterRuleComponent of filterRuleComponents) {
      let rule = filterRuleComponent.getJson();
      if (!rule) {
        // We should already have shown the user an alert here since this
        // happens when they use an invalid field.
        return;
      }
      rules.push(rule);
    }
    await this.settings_.writeFilters(rules);

    defined(this.dialog_).remove();
  }

  cancel_() {
    // TODO: prompt if there are changes.
    defined(this.dialog_).remove();
  }

  async createRule_(rule: any) {
    let row = document.createElement('div');
    row.className = FiltersView.ROW_CLASSNAME_;
    row.style.cssText = `
      margin-bottom: 16px;
      display: flex;
    `;

    const insertRowBefore = async () => {
      let emptyRule = await this.createRule_(
          {label: filterRuleComponent.getSelectedLabel()});
      row.before(emptyRule);
    };
    let topButtons = document.createElement('div');
    topButtons.style.cssText = `
      display: flex;
      margin-bottom: 4px;
    `;
    const deleteButton = this.createButton_('-', 'Delete this rule', () => {
      const backdrop = document.createElement('div');
      backdrop.className = 'z4 fixed all-0';
      backdrop.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        backdrop.remove();
        reallyDeleteButton.remove();
      });

      const reallyDeleteButton = createMktimeButton(() => {
        row.remove();
        backdrop.remove();
      }, 'Really delete?');
      reallyDeleteButton.classList.add('red-important', 'z5', 'no-hover');
      // Use inline style to override the position:relative on .mktime-button.
      reallyDeleteButton.style.position = 'absolute';
      deleteButton.before(backdrop, reallyDeleteButton);
    });
    topButtons.append(
        this.createButton_('+', 'Add new row above', insertRowBefore),
        deleteButton);
    let bottomButtons = document.createElement('div');
    bottomButtons.style.cssText = `
          display: flex;
        `;
    bottomButtons.append(
        this.createButton_(
            '⇧', 'Move rule up', () => this.moveRow_(row, 'ArrowUp', false)),
        this.createButton_(
            '⇩', 'Move rule down',
            () => this.moveRow_(row, 'ArrowDown', false)));

    let buttonContainer = document.createElement('div');
    buttonContainer.style.cssText = `
          margin-right: 16px;
        `;
    buttonContainer.append(topButtons, bottomButtons);

    let filterRuleComponent = new FilterRuleComponent(this.settings_, rule);
    row.append(buttonContainer, filterRuleComponent);

    return row;
  }

  private createButton_(
      text: string, title: string,
      onClick: (e: MouseEvent) => void|Promise<void>) {
    const button = create('span', text);
    button.classList.add('row-button');
    button.setAttribute('title', title);
    button.onclick = onClick;
    return button;
  }
}

window.customElements.define('mt-filters', FiltersView);
