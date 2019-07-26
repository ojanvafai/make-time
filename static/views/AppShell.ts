import {createSvgButton, defined, DOWN_ARROW_SVG, DOWN_ARROW_VIEW_BOX, notNull} from '../Base.js';
import {getSettings, showHelp} from '../BaseMain.js';
import {COMPLETED_EVENT_NAME, RadialProgress} from '../RadialProgress.js';

import {FilterDialogView} from './FilterDialogView.js';

let progressElements: Map<string, RadialProgress> = new Map();
let titleStack_: TitleEntry[] = [];
let loaderTitleStack_: TitleEntry[] = [];

interface TitleEntry {
  key: string;
  title: (HTMLElement|string)[];
}

let CURRENT_PAGE_CLASS = 'current-page';

export class BackEvent extends Event {
  static NAME = 'back';
  constructor() {
    super(BackEvent.NAME);
  }
}

export class ToggleViewEvent extends Event {
  static NAME = 'toggle-view';
  constructor() {
    super(ToggleViewEvent.NAME);
  }
}

export class OverflowMenuOpenEvent extends Event {
  static NAME = 'overflow-menu-open';
  constructor(public container: HTMLElement) {
    super(OverflowMenuOpenEvent.NAME);
  }
}

export class AppShell extends HTMLElement {
  private drawer_: HTMLElement;
  private mainContent_: HTMLElement;
  private content_: HTMLElement;
  private backArrow_: SVGSVGElement;
  private toolbar_: HTMLElement;
  private menuToggle_: SVGSVGElement;
  private filterToggle_: SVGSVGElement;
  private viewToggle_: SVGSVGElement;
  private overflowMenuButton_: SVGSVGElement;
  private overflowMenu_?: HTMLElement;
  private clickOverlay_?: HTMLElement;
  private subject_: HTMLElement;
  private drawerOpen_: boolean;
  private queryParameters_?: {[property: string]: string};

  // TODO: Make these not static.
  private static title_: HTMLElement;
  private static loader_: HTMLElement;
  private static footer_: HTMLElement;

  constructor() {
    super();
    this.drawerOpen_ = false;

    let panelStyle = `
      transition: transform 0.3s ease;
      position: absolute;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      overflow: auto;
    `;

    this.drawer_ = document.createElement('div');
    this.drawer_.id = 'drawer';
    this.drawer_.style.cssText = panelStyle;

    this.mainContent_ = document.createElement('div');
    this.mainContent_.style.cssText = `
      will-change: transform;
      background: var(--main-background, #fff);
      box-shadow: -1px 0 4px #999;
      display: flex;
      flex-direction: column;
      align-items: stretch;
      ${panelStyle}
    `;

    document.body.append(this.drawer_, this.mainContent_);

    this.toolbar_ = document.createElement('div');
    this.toolbar_.className = 'toolbar';
    this.toolbar_.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      position: relative;
      width: -webkit-fill-available;
      box-shadow: var(--border-and-hover-color) 0 0 4px;
      z-index: 20;
      background-color: var(--nested-background-color);
    `;

    let contentContainer = document.createElement('div');
    contentContainer.style.cssText = `
      overflow: auto;
      flex: 1;
    `;

    this.content_ = document.createElement('div');
    this.content_.style.cssText = `
      flex: 1;
      height: 100%;
      width: 100%;
      max-width: var(--max-width);
      margin: auto;
    `;
    contentContainer.append(this.content_);

    AppShell.footer_ = document.createElement('div');
    AppShell.footer_.className = 'toolbar';
    AppShell.footer_.style.cssText = `
      z-index: 1000;
      position: sticky;
      bottom: 0;
      width: -webkit-fill-available;
      display: flex;
      justify-content: center;
      align-self: center;
      box-shadow: var(--border-and-hover-color) 0 0 4px;
      background-color: var(--nested-background-color);
      /* Don't eat clicks in the transparent background of the footer. */
      pointer-events: none;
    `;

    this.mainContent_.append(this.toolbar_, contentContainer, AppShell.footer_);

    this.backArrow_ = createSvgButton(
        DOWN_ARROW_VIEW_BOX, () => this.dispatchEvent(new BackEvent()),
        DOWN_ARROW_SVG);
    // Too lazy to rework the arrow to point left, so just use CSS Transforms.
    this.backArrow_.style.cssText = `
      transform: rotate(90deg);
      display: none;
    `;

    const menuToggleContents =
        `<path d="M4,10h24c1.104,0,2-0.896,2-2s-0.896-2-2-2H4C2.896,6,2,6.896,2,8S2.896,10,4,10z M28,14H4c-1.104,0-2,0.896-2,2 s0.896,2,2,2h24c1.104,0,2-0.896,2-2S29.104,14,28,14z M28,22H4c-1.104,0-2,0.896-2,2s0.896,2,2,2h24c1.104,0,2-0.896,2-2 S29.104,22,28,22z"></path>`;
    this.menuToggle_ = createSvgButton('0 0 32 32', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    }, menuToggleContents);

    let filterToggleContents =
        `<g transform="translate(0,1280) scale(0.1,-0.1)">
      <path d="M102 12678 c58 -68 1233 -1459 2613 -3093 1380 -1633 2542 -3009 2582 -3056 l73 -86 0 -3221 0 -3221 790 792 790 792 0 2430 1 2430 1470 1740 c1881 2225 2386 2823 3193 3780 362 429 670 792 684 808 l26 27 -6163 0 -6163 0 104 -122z"/>
    </g>`;
    this.filterToggle_ = createSvgButton(
        '0 0 1232 1280', () => this.openFilterMenu_(), filterToggleContents);
    this.filterToggle_.style.cssText = `
      margin: 0 6px;
    `;

    let viewToggleContents =
        `<path d="M 17 2 L 17 6 L 3 6 L 3 8 L 17 8 L 17 12 L 22 7 L 17 2 M 7 12 L 2 17 L 7 22 L 7 18 L 21 18 L 21 16 L 7 16 L 7 12"></path>`;
    this.viewToggle_ = createSvgButton(
        '0 0 24 24', () => this.dispatchEvent(new ToggleViewEvent()),
        viewToggleContents);
    this.viewToggle_.style.cssText = `
      display: none;
      margin-left: 6px;
    `;

    let overflowMenuContents =
        `<circle cx="12" cy="5" r="2"/><circle cx="12" cy="12" r="2"/><circle cx="12" cy="19" r="2"/>`;
    this.overflowMenuButton_ = createSvgButton(
        '0 0 24 24', () => this.toggleOverflowMenu_(), overflowMenuContents);

    let toolbarChildStyle = `
      display: flex;
      align-items:center;
    `;

    AppShell.title_ = document.createElement('div');
    AppShell.title_.className = 'hide-if-empty';
    AppShell.title_.id = 'title';
    AppShell.title_.style.cssText = `
      margin: 0 4px;
      ${toolbarChildStyle}
    `;

    this.subject_ = document.createElement('div');
    this.subject_.style.cssText = `
      flex: 1;
      ${toolbarChildStyle}
    `;

    AppShell.loader_ = document.createElement('div');
    AppShell.loader_.className = 'hide-if-empty';
    AppShell.loader_.style.cssText = `
      ${toolbarChildStyle}
    `;

    this.toolbar_.append(
        this.backArrow_, this.menuToggle_, this.viewToggle_, this.filterToggle_,
        AppShell.title_, this.subject_, AppShell.loader_,
        this.overflowMenuButton_);

    this.appendMenu_();

    this.mainContent_.addEventListener('click', (e) => {
      if (this.drawerOpen_) {
        e.preventDefault();
        this.closeMenu();
      }
    });
  }

  showViewAndFilterToggles(show: boolean) {
    this.filterToggle_.style.display = show ? '' : 'none';
    this.viewToggle_.style.display = show ? '' : 'none';
  }

  showOverflowMenuButton(show: boolean) {
    this.overflowMenuButton_.style.display = show ? '' : 'none';
  }

  closeOverflowMenu() {
    defined(this.overflowMenu_).remove();
    this.overflowMenu_ = undefined;
    defined(this.clickOverlay_).remove();
    this.clickOverlay_ = undefined;
  }

  private toggleOverflowMenu_() {
    if (this.overflowMenu_) {
      this.closeOverflowMenu();
      return;
    }

    let container = notNull(this.overflowMenuButton_.parentNode);

    this.clickOverlay_ = document.createElement('div');
    this.clickOverlay_.style.cssText = `
      position: fixed;
      top: 0;
      right: 0;
      bottom: 0;
      left: 0;
      z-index: 1000000;
    `;
    this.clickOverlay_.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      this.closeOverflowMenu();
    });
    container.append(this.clickOverlay_);

    this.overflowMenu_ = document.createElement('div');
    this.overflowMenu_.style.cssText = `
      position: fixed;
      right: 0;
      top: 0;
      background-color: var(--overlay-background-color);
      border: 1px solid var(--border-and-hover-color);
      box-shadow: 0px 0px 6px 0px var(--border-and-hover-color);
      z-index: 1000001;
    `;
    container.append(this.overflowMenu_);

    this.dispatchEvent(new OverflowMenuOpenEvent(this.overflowMenu_));
  }

  static setFooter(dom?: HTMLElement) {
    AppShell.footer_.textContent = '';
    if (dom)
      AppShell.addToFooter(dom);
  }

  static addToFooter(dom: HTMLElement) {
    // Set pointerEvents if it's not already set so that the pointer-events:none
    // on the footer itself doesn't prevent clicks.
    // TODO: This is brittle (e.g. doens't work with stylesheets). Find a better
    // way.
    if (!dom.style.pointerEvents)
      dom.style.pointerEvents = 'all';
    AppShell.footer_.append(dom);
  }

  static updateTitle(key: string, ...opt_title: string[]) {
    AppShell.updateTitleBase(titleStack_, AppShell.title_, key, ...opt_title);
  }

  static updateLoaderTitle(
      key: string, count: number, ...opt_title: (HTMLElement|string)[]) {
    let progress = progressElements.get(key);
    if (!progress) {
      progress = new RadialProgress();
      progressElements.set(key, progress);
      progress.addEventListener(COMPLETED_EVENT_NAME, () => {
        AppShell.clearLoaderTitle(key);
      });
    }

    progress.addToTotal(count);

    AppShell.updateTitleBase(
        loaderTitleStack_, AppShell.loader_, key, ...opt_title, progress);
    return progress;
  }

  static clearLoaderTitle(key: string) {
    AppShell.updateTitleBase(loaderTitleStack_, AppShell.loader_, key);
  }

  static updateTitleBase(
      stack: TitleEntry[], node: HTMLElement, key: string,
      ...opt_title: (HTMLElement|string)[]) {
    let index = stack.findIndex((item) => item.key == key);
    if (!opt_title[0]) {
      if (index != -1)
        stack.splice(index, 1);
    } else if (index == -1) {
      stack.push({
        key: key,
        title: opt_title,
      });
    } else {
      let entry = stack[index];
      entry.title = opt_title;
    }

    node.textContent = '';
    if (stack.length)
      node.append(...stack[stack.length - 1].title);
  }

  async openFilterMenu_() {
    new FilterDialogView(await getSettings(), this.queryParameters_);
  }

  setContent(newContent: HTMLElement) {
    this.content_.textContent = '';
    this.content_.append(newContent);
  }

  getScroller() {
    return this.content_.parentElement;
  }

  setSubject(...items: (string|Node)[]) {
    this.subject_.textContent = '';
    this.subject_.append(...items);
  }

  get contentScrollTop() {
    return notNull(this.content_.parentElement).scrollTop;
  }

  set contentScrollTop(value: number) {
    notNull(this.content_.parentElement).scrollTop = value;
  }

  setQueryParameters(params: {[property: string]: string}) {
    this.queryParameters_ = params;
    let hasFilterParams = FilterDialogView.containsFilterParameter(params);
    this.filterToggle_.style.fill = hasFilterParams ? 'red' : '';
  }

  showToolbar(show?: boolean) {
    this.toolbar_.style.display = show ? 'flex' : 'none';
  }

  showBackArrow(show: boolean) {
    this.menuToggle_.style.display = show ? 'none' : '';
    this.backArrow_.style.display = show ? '' : 'none';
  }

  private createMenuItem_(name: string, options: any) {
    let a = document.createElement('a');
    a.append(name);
    a.className = 'item';

    if (options.href)
      a.href = options.href;

    if (options.onclick)
      a.onclick = options.onclick;

    a.addEventListener('click', () => this.closeMenu());
    return a;
  }

  private appendMenu_() {
    this.drawer_.append(
        this.createMenuItem_('Compose', {href: '/compose'}),
        this.createMenuItem_('Triage', {href: '/triage'}),
        this.createMenuItem_('Todo', {href: '/todo'}),
        this.createMenuItem_('Hidden', {href: '/hidden'}),
        this.createMenuItem_('Calendar (alpha)', {href: '/calendar'}),
        this.createMenuItem_('Track (alpha)', {href: '/track'}),
        this.createMenuItem_('Settings', {href: '/settings'}),
        this.createMenuItem_('Help', {onclick: () => showHelp()}));
  }

  private openMenu() {
    let menuItems =
        <NodeListOf<HTMLAnchorElement>>this.drawer_.querySelectorAll('a.item');
    for (let item of menuItems) {
      if (item.pathname == location.pathname) {
        item.classList.add(CURRENT_PAGE_CLASS);
      } else {
        item.classList.remove(CURRENT_PAGE_CLASS);
      }
    }

    this.drawerOpen_ = true;
    this.mainContent_.style.transform = 'translateX(250px)';
  }

  private closeMenu() {
    this.drawerOpen_ = false;
    this.mainContent_.style.transform = '';
  }

  private toggleMenu() {
    if (this.drawerOpen_)
      this.closeMenu();
    else
      this.openMenu();
  }
}
window.customElements.define('mt-appshell', AppShell);
