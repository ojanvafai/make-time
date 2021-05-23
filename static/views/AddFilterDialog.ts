import { FilterRuleComponent } from './FilterRuleComponent';
import { Settings, FilterRule, HeaderFilterRule } from '../Settings';
import { parseAddressList, create, createMktimeButton } from '../Base';
import { Dialog } from '../Dialog';
import { Thread } from '../Thread';
import { MailProcessor } from '../MailProcessor';

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

export class AddFilterDialog extends HTMLElement {
  private filterRuleComponent_: FilterRuleComponent;
  private filterSaveButton_: HTMLButtonElement;
  private dialog_: Dialog;

  constructor(
    private settings_: Settings,
    private thread_: Thread,
    private allUnfiltredThreads_: Thread[],
    private getMailProcessor_: () => Promise<MailProcessor>,
    private afterSave_: () => void,
  ) {
    super();
    this.className = 'p1 block';

    // Prefill the rule with the first sender of the first message.
    const firstMessage = thread_.getMessages()[0];
    const rule = { from: firstMessage.parsedFrom[0].address };

    this.filterRuleComponent_ = new FilterRuleComponent(rule);
    this.filterRuleComponent_.classList.add('m-half');
    this.append(this.filterRuleComponent_, this.createHeaderMenu_(firstMessage.getHeaders()));

    this.filterSaveButton_ = createMktimeButton(
      () => this.saveFilterRule_(),
      'Save and apply filter',
    );
    const closeButton = createMktimeButton(() => this.dialog_.remove(), 'close');
    this.dialog_ = new Dialog(this, [closeButton, this.filterSaveButton_]);
  }

  private createHeaderMenu_(headers: gapi.client.gmail.MessagePartHeader[]) {
    const headerMenu = document.createElement('div');
    headerMenu.className = 'overflow-auto';

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
        const address = parseAddressList(value)[0];
        if (address) {
          value = address.address;
        }
      }

      const container = document.createElement('label');
      container.className = 'flex items-center flex-expand-1';
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
        this.filterRuleComponent_.add(directiveName, value);
      };

      const minusButton = create('span', '-');
      minusButton.classList.add('row-button');
      minusButton.setAttribute('title', 'Remove from filter rule');
      minusButton.onclick = () => {
        this.filterRuleComponent_.delete(directiveName);
      };

      container.append(addButton, minusButton, nameContainer, value);

      if (
        HEADER_FILTER_MENU_INCLUDES.some((x) => lowercaseName.includes(x)) ||
        !HEADER_FILTER_MENU_EXCLUDES.some((x) => lowercaseName.includes(x))
      ) {
        headerMenu.append(container);
      }
    }
    return headerMenu;
  }

  private async saveFilterRule_() {
    // Save this off before any awaits to avoid races using it later
    const thread = this.thread_;
    const ruleJson = this.filterRuleComponent_.getJson();
    if (!ruleJson) {
      // We should already have shown the user an alert here since this
      // happens when they use an invalid field.
      return;
    }

    const mailProcessor = await this.getMailProcessor_();
    const ruleMatches = await mailProcessor.ruleMatchesMessages(ruleJson, thread.getMessages());
    if (!ruleMatches) {
      alert("This filter rule doesn't match the current thread.");
      return;
    }

    this.filterSaveButton_.textContent = 'Saving filter...';
    this.filterSaveButton_.disabled = true;

    try {
      const existingFilterRules = await this.settings_.getFilters();
      await this.settings_.writeFilters(this.mergeFilterRule_(existingFilterRules, ruleJson));
      await mailProcessor.applyFilters(thread);
      this.dialog_.remove();
      this.afterSave_();
      this.allUnfiltredThreads_.forEach((x) => mailProcessor.applyFilters(x));
    } catch (e) {
      this.filterSaveButton_.textContent = 'Retry saving filter';
      this.filterSaveButton_.disabled = false;
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
}

window.customElements.define('mt-add-filter-dialog', AddFilterDialog);
