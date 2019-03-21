import {showHelp} from '../BaseMain.js';
import {COMPLETED_EVENT_NAME, RadialProgress} from '../RadialProgress.js';

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

export class AppShell extends HTMLElement {
  private drawer_: HTMLElement;
  private mainContent_: HTMLElement;
  private content_: HTMLElement;
  private backArrow_: HTMLElement;
  private menuToggle_: SVGSVGElement;
  private subject_: HTMLElement;
  private drawerOpen_: boolean;

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
    `;

    this.drawer_ = document.createElement('div');
    this.drawer_.id = 'drawer';
    this.drawer_.style.cssText = panelStyle;

    this.mainContent_ = document.createElement('div');
    this.mainContent_.style.cssText = `
      will-change: transform;
      background: #eee;
      display: flex;
      flex-direction: column;
      ${panelStyle}
    `;

    document.body.append(this.drawer_, this.mainContent_);

    let toolbar = document.createElement('div');
    toolbar.style.cssText = `
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      background-color: black;
      color: white;
      padding: 6px;
      position: relative;
    `;

    this.content_ = document.createElement('div');
    this.content_.style.cssText = `
      flex: 1;
      overflow: auto;
      height: 100%;
    `;

    AppShell.footer_ = document.createElement('div');
    AppShell.footer_.style.cssText = `
      position: sticky;
      bottom: 0;
      left: 0;
      right: 0;
      display: flex;
      justify-content: center;
      /* Don't eat clicks in the transparent background of the footer. */
      pointer-events: none;
    `;

    this.mainContent_.append(toolbar, this.content_, AppShell.footer_);

    this.backArrow_ = document.createElement('div');
    this.backArrow_.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: center;
      display: none;
    `;
    this.backArrow_.className = 'menu-open-button';
    this.backArrow_.textContent = '⬅';

    this.menuToggle_ =
        document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    this.menuToggle_.classList.add('menu-open-button');
    this.menuToggle_.setAttribute('viewBox', '0 0 32 32');
    let path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute(
        'd',
        `M4,10h24c1.104,0,2-0.896,2-2s-0.896-2-2-2H4C2.896,6,2,6.896,2,8S2.896,10,4,10z M28,14H4c-1.104,0-2,0.896-2,2  s0.896,2,2,2h24c1.104,0,2-0.896,2-2S29.104,14,28,14z M28,22H4c-1.104,0-2,0.896-2,2s0.896,2,2,2h24c1.104,0,2-0.896,2-2  S29.104,22,28,22z`);
    this.menuToggle_.append(path);

    let toolbarChildStyle = `
      margin-right: 4px;
      display: flex;
      align-items:center;
    `;

    AppShell.title_ = document.createElement('div');
    AppShell.title_.id = 'title';
    AppShell.title_.style.cssText = `
      margin-left: 4px;
      ${toolbarChildStyle}
    `;

    this.subject_ = document.createElement('div');
    this.subject_.style.cssText = `
      text-align: center;
      flex: 1;
      ${toolbarChildStyle}
    `;

    AppShell.loader_ = document.createElement('div');
    AppShell.loader_.style.cssText = `
      ${toolbarChildStyle}
    `;

    toolbar.append(
        this.backArrow_, this.menuToggle_, AppShell.title_, this.subject_,
        AppShell.loader_);

    this.appendMenu_();
    this.menuToggle_.addEventListener('click', (e) => {
      e.stopPropagation();
      this.toggleMenu();
    });

    this.mainContent_.addEventListener('click', (e) => {
      if (this.drawerOpen_) {
        e.preventDefault();
        this.closeMenu();
      }
    });

    this.backArrow_.addEventListener(
        'click', () => this.dispatchEvent(new BackEvent()));
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


  setContent(newContent: HTMLElement) {
    this.content_.textContent = '';
    newContent.style.width = '100%';
    newContent.style.maxWidth = '1000px';
    newContent.style.margin = 'auto';
    this.content_.append(newContent);
  }

  setSubject(...items: (string|Node)[]) {
    this.subject_.textContent = '';
    this.subject_.append(...items);
  }

  get contentScrollTop() {
    return this.content_.scrollTop;
  }

  set contentScrollTop(value: number) {
    this.content_.scrollTop = value;
  }

  showMenuButton(hide?: boolean) {
    this.menuToggle_.style.visibility = hide ? 'hidden' : 'visible';
  }

  showBackArrow(show: boolean) {
    this.menuToggle_.style.display = show ? 'none' : '';
    this.backArrow_.style.display = show ? 'flex' : 'none';
  }

  private createMenuItem_(name: string, options: any) {
    let a = document.createElement('a');
    a.append(name);
    a.className = 'item';

    if (options.nested)
      a.classList.add('nested');

    if (options.href)
      a.href = options.href;

    if (options.onclick)
      a.onclick = options.onclick;

    a.addEventListener('click', () => this.closeMenu());
    return a;
  }

  private appendMenu_() {
    let helpButton = this.createMenuItem_('Help', {
      onclick: async () => showHelp(),
    });

    let menuTitle = document.createElement('div');
    menuTitle.append('MakeTime phases');

    this.drawer_.append(
        menuTitle,
        this.createMenuItem_('Compose', {href: '/compose', nested: true}),
        this.createMenuItem_('Triage', {href: '/triage', nested: true}),
        this.createMenuItem_('Todo', {href: '/todo', nested: true}),
        this.createMenuItem_('Hidden', {href: '/hidden', nested: true}),
        this.createMenuItem_('Calendar (alpha)', {href: '/calendar'}),
        this.createMenuItem_('Settings', {href: '/settings'}), helpButton);
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
window.customElements.define('mk-appshell', AppShell);
