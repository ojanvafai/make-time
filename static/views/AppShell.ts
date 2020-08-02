import {createCircle, createLine, createPath, createSvg, createSvgButton, defined, leftArrow, notNull} from '../Base.js';
import {getSettings, showHelp} from '../BaseMain.js';
import {Dialog} from '../Dialog.js';
import {COMPLETED_EVENT_NAME, ProgressTracker} from '../ProgressTracker.js';

import {FilterDialogView} from './FilterDialogView.js';

let progressElements: Map<string, ProgressTracker> = new Map();
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
  private backArrow_: SVGElement;
  private toolbar_: HTMLElement;
  private menuToggle_: SVGElement;
  private filterToggle_: SVGElement;
  private overflowMenuButton_: SVGElement;
  private overflowMenu_?: HTMLElement;
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
      max-width: var(--max-width);
      margin: auto;
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
    `;
    contentContainer.append(this.content_);

    AppShell.footer_ = document.createElement('div');
    AppShell.footer_.className = 'toolbar';
    AppShell.footer_.style.cssText = `
      z-index: 1000;
      position: sticky;
      bottom: 0;
      width: -webkit-fill-available;
      box-shadow: var(--border-and-hover-color) 0 0 4px;
      background-color: var(--nested-background-color);
      /* Don't eat clicks in the transparent background of the footer. */
      pointer-events: none;
    `;
    // iphones have a gutter for the swipe up gesture that gets pointerdown
    // events but not a pointer up. So move the toolbar up to avoid that.
    if (navigator.standalone) {
      AppShell.footer_.style.paddingBottom = '40px';
    }

    let toolbarWrapper = document.createElement('div');
    toolbarWrapper.style.cssText = `
      box-shadow: var(--border-and-hover-color) 0 0 4px;
      background-color: var(--nested-background-color);
      z-index: 20;
    `;
    toolbarWrapper.append(this.toolbar_);

    this.mainContent_.append(
        toolbarWrapper, contentContainer, AppShell.footer_);

    this.backArrow_ =
        leftArrow('back-arrow', () => this.dispatchEvent(new BackEvent()));
    this.backArrow_.style.cssText = `
      display: none;
    `;

    this.menuToggle_ = createSvgButton(
        '0 0 24 24',
        (e) => {
          e.stopPropagation();
          this.toggleMenu();
        },
        createLine(2, 5, 22, 5, 3),
        createLine(2, 12, 22, 12, 3),
        createLine(2, 19, 22, 19, 3),
    );

    this.filterToggle_ = createSvgButton(
        '0 0 24 24',
        () => this.openFilterMenu_(),
        createLine(2, 5, 22, 5, 3),
        createLine(6, 12, 18, 12, 3),
        createLine(10, 19, 14, 19, 3),
    );
    this.filterToggle_.style.margin = '0 6px';

    this.overflowMenuButton_ = createSvgButton(
        '0 0 24 24',
        () => this.toggleOverflowMenu_(),
        createCircle(12, 5, 2),
        createCircle(12, 12, 2),
        createCircle(12, 19, 2),
    );


    AppShell.title_ = document.createElement('div');
    AppShell.title_.className =
        'hide-if-empty flex items-center text-color-dim mx-half';
    AppShell.title_.id = 'title';

    this.subject_ = document.createElement('div');
    this.subject_.className =
        'contains-pii justify-center flex-expand-1 flex items-center text-color-dim';

    AppShell.loader_ = document.createElement('div');
    AppShell.loader_.className = 'hide-if-empty flex items-center';

    this.toolbar_.append(
        this.backArrow_, this.menuToggle_, this.filterToggle_, AppShell.title_,
        this.subject_, AppShell.loader_, this.overflowMenuButton_);
    this.appendMenu_();

    this.mainContent_.addEventListener('click', (e) => {
      if (this.drawerOpen_) {
        e.preventDefault();
        this.closeMenu();
      }
    });
  }

  createViewToggleSVG_() {
    let marker = createSvg('marker', createPath('M0,0 V4 L2,2 Z'));
    marker.setAttribute('id', 'head');
    marker.setAttribute('orient', 'auto-start-reverse');
    marker.setAttribute('markerWidth', '2');
    marker.setAttribute('markerHeight', '4');
    marker.setAttribute('refY', '2');

    let rightArrow = createLine(2, 6, 18, 6, 2.5);
    rightArrow.setAttribute('marker-end', 'url(#head)');
    let leftArrow = createLine(6, 18, 21, 18, 2.5);
    leftArrow.setAttribute('marker-start', 'url(#head)');

    return createSvgButton(
        '0 0 24 24', () => this.dispatchEvent(new ToggleViewEvent()),
        createSvg('defs', marker), rightArrow, leftArrow);
  }

  showFilterToggle(show: boolean) {
    this.filterToggle_.style.display = show ? '' : 'none';
  }

  showOverflowMenuButton(show: boolean) {
    this.overflowMenuButton_.style.display = show ? '' : 'none';
  }

  closeOverflowMenu() {
    defined(this.overflowMenu_).remove();
  }

  private toggleOverflowMenu_() {
    if (this.overflowMenu_) {
      this.closeOverflowMenu();
      return;
    }

    const rect = this.overflowMenuButton_.getBoundingClientRect();
    let buttonContainer = document.createElement('div');
    this.dispatchEvent(new OverflowMenuOpenEvent(buttonContainer));

    this.overflowMenu_ =
        new Dialog(document.createElement('div'), [buttonContainer], {
          right: `${window.innerWidth - rect.right}px`,
          top: `${rect.bottom}px`,
        });
    this.overflowMenu_.addEventListener(
        'close', () => this.overflowMenu_ = undefined);
  }

  static setFooter(dom?: HTMLElement) {
    AppShell.footer_.textContent = '';
    if (dom)
      AppShell.addToFooter(dom);
  }

  static addToFooter(...nodes: (string|HTMLElement)[]) {
    // Set pointerEvents if it's not already set so that the pointer-events:none
    // on the footer itself doesn't prevent clicks.
    // TODO: This is brittle (e.g. doens't work with stylesheets). Find a better
    // way.
    for (let node of nodes) {
      let style = (node as HTMLElement).style;
      if (style && !style.pointerEvents) {
        style.pointerEvents = 'all';
      }
      AppShell.footer_.append(node);
    }
  }

  static updateTitle(key: string, ...opt_title: string[]) {
    AppShell.updateTitleBase(titleStack_, AppShell.title_, key, ...opt_title);
  }

  static updateLoaderTitle(
      key: string, count: number, ...opt_title: (HTMLElement|string)[]) {
    let progress = progressElements.get(key);
    if (!progress) {
      progress = new ProgressTracker();
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
    const rect = this.filterToggle_.getBoundingClientRect();
    new FilterDialogView(
        await getSettings(), {top: `${rect.bottom}px`, left: `${rect.left}px`},
        this.queryParameters_);
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

  getContentHeight() {
    return this.content_.offsetHeight;
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
        this.createMenuItem_('Todo', {href: '/todo'}),
        this.createMenuItem_('Hidden', {href: '/hidden'}),
        this.createMenuItem_('Calendar (alpha)', {href: '/calendar'}),
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
