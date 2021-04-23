import { collapseArrow, expandArrow } from './Base';
import { Message } from './Message';
import { QuoteElidedMessage } from './QuoteElidedMessage';

let formattingOptions: {
  year?: 'numeric' | '2-digit';
  month?: 'numeric' | '2-digit' | 'long' | 'short' | 'narrow';
  day?: 'numeric' | '2-digit';
  hour?: 'numeric' | '2-digit';
  minute?: 'numeric' | '2-digit';
} = {
  hour: 'numeric',
  minute: 'numeric',
};

let SAME_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, formattingOptions);

formattingOptions.month = 'short';
formattingOptions.day = 'numeric';

let DIFFERENT_DAY_FORMATTER = new Intl.DateTimeFormat(undefined, formattingOptions);

formattingOptions.year = 'numeric';
let DIFFERENT_YEAR_FORMATTER = new Intl.DateTimeFormat(undefined, formattingOptions);

export class RenderedMessage extends HTMLElement {
  constructor(
    processedMessage: Message,
    quoteElidedMessage: QuoteElidedMessage,
    options?: { renderAsCard?: boolean },
  ) {
    super();
    this.style.cssText = `
      display: block;
      padding: 8px;
      word-break: break-word;
      ${
        options?.renderAsCard
          ? `margin-bottom: 40px; background-color: var(--thread-background-color);`
          : ''
      }
    `;
    this.className = `message thread-text-color reading-max-width fill-available-width mx-autov ${
      options?.renderAsCard ? 'card-shadow' : ''
    }`;
    this.classList.add(processedMessage.isUnread ? 'unread' : 'read');

    var headerDiv = document.createElement('div');
    headerDiv.classList.add('headers');
    headerDiv.style.cssText = `
      white-space: pre-wrap;
      margin-bottom: 16px;
    `;

    let from = document.createElement('div');
    from.className = 'contains-pii';
    from.style.flex = '1';

    if (processedMessage.parsedFrom.length) {
      let parsed = processedMessage.parsedFrom[0];
      if (parsed.name) {
        let b = document.createElement('b');
        b.append(parsed.name);
        from.append(b, ' <', parsed.address, '>');
      } else {
        from.append(parsed.address);
      }
    }

    let date = document.createElement('div');
    date.style.color = 'var(--dim-text-color)';
    date.append(this.dateString_(processedMessage.date));

    let topRow = document.createElement('div');
    topRow.style.cssText = `
      display: flex;
      margin-bottom: 4px;
    `;
    topRow.append(from, date);

    let to = document.createElement('div');
    to.style.cssText = `
      cursor: pointer;
      overflow: hidden;
    `;

    let expander = document.createElement('span');
    expander.classList.add('expander');
    expander.style.cssText = `
      cursor: pointer;
      font-size: 75%;
      width: 18px;
      margin-left: -2px;
      display: flex;
      align-items: center;
      justify-content: center;
      user-select: none;
      -webkit-user-select: none;
      border-radius: 3px;
    `;

    let bottomRow = document.createElement('div');
    bottomRow.style.cssText = `
      display: flex;
      align-items: center;
      color: var(--dim-text-color);
      font-size: 90%;
    `;
    bottomRow.append(expander, to);

    let toggleClamp = () => {
      let shouldMinify = to.style.whiteSpace !== 'nowrap';
      to.style.whiteSpace = shouldMinify ? 'nowrap' : '';
      expander.textContent = '';
      expander.append(shouldMinify ? expandArrow() : collapseArrow());
      bottomRow.style.fontSize = shouldMinify ? '90%' : '';
      this.renderTo_(processedMessage, to, shouldMinify);
    };
    to.addEventListener('click', toggleClamp);
    expander.addEventListener('click', toggleClamp);
    toggleClamp();

    headerDiv.append(topRow, bottomRow);

    if (processedMessage.isDraft) {
      let draft = document.createElement('div');
      draft.style.cssText = `
        font-weight: bold;
        margin-top: 10px;
      `;
      draft.append('DRAFT MESSAGE');
      headerDiv.append(draft);
    }

    var bodyContainer = document.createElement('div');
    bodyContainer.className = 'message-body contains-pii';
    // Rather than have nested scrollbars, clip overflow. This matches gmail.
    bodyContainer.style.overflowY = 'hidden';
    bodyContainer.style.overflowX = 'auto';
    bodyContainer.append(quoteElidedMessage);

    this.append(headerDiv, bodyContainer);
  }

  private dateString_(date: Date) {
    let formatter: Intl.DateTimeFormat;
    let today = new Date();
    if (today.getFullYear() != date.getFullYear()) {
      formatter = DIFFERENT_YEAR_FORMATTER;
    } else if (today.getMonth() != date.getMonth() || today.getDate() != date.getDate()) {
      formatter = DIFFERENT_DAY_FORMATTER;
    } else {
      formatter = SAME_DAY_FORMATTER;
    }
    return formatter.format(date);
  }

  renderTo_(processedMessage: Message, container: HTMLElement, shouldMinify: boolean) {
    container.textContent = '';

    if (processedMessage.to) {
      this.appendAddresses_(
        container,
        'to',
        shouldMinify ? Message.minifyAddressList(processedMessage.parsedTo) : processedMessage.to,
      );
    }
    if (processedMessage.cc) {
      this.appendAddresses_(
        container,
        'cc',
        shouldMinify ? Message.minifyAddressList(processedMessage.parsedCc) : processedMessage.cc,
      );
    }
    if (processedMessage.bcc) {
      this.appendAddresses_(
        container,
        'bcc',
        shouldMinify ? Message.minifyAddressList(processedMessage.parsedBcc) : processedMessage.bcc,
      );
    }
  }

  appendAddresses_(container: HTMLElement, name: string, value: string) {
    let div = document.createElement('div');
    let b = document.createElement('b');
    b.append(`${name}: `);
    let valueContainer = document.createElement('span');
    valueContainer.className = 'contains-pii';
    valueContainer.append(value);
    div.append(b, valueContainer);
    container.append(div);
  }
}
window.customElements.define('mt-rendered-message', RenderedMessage);
