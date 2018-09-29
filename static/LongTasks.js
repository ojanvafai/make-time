class LongTasks extends HTMLElement {
  constructor() {
    super();
    var observer = new PerformanceObserver((list) => {
      for (let entry of list.getEntries()) {
        // TODO: Make the flashing threshold configurable.
        if (entry.duration > 200) {
          console.log(entry)
          this.flash();
          return;
        }
      }
    });
    observer.observe({entryTypes: ["longtask"]});
  }

  flash() {
    this.style.cssText = `
      background-color: red;
      opacity: 0.5;
      position: fixed;
      top: 0;
      right: 0;
      left: 0;
      bottom: 0;
    `;
    setTimeout(() => this.style.display = 'none', 1000);
  }
}

window.customElements.define('mt-long-tasks', LongTasks);
