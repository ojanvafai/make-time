export class LongTasks extends HTMLElement {
  constructor() {
    super();

    var observer = new PerformanceObserver((list) => {
      for (let entry of list.getEntries()) {
        // TODO: Make the flashing threshold configurable.
        if (entry.duration > 200) {
          console.log(entry)
          this.flash_();
          return;
        }
      }
    });
    observer.observe({entryTypes: ["longtask"]});
  }

  connectedCallback() {
    this.style.cssText = `
      background-color: red;
      opacity: 0;
      position: fixed;
      top: 0;
      right: 0;
      left: 0;
      bottom: 0;
      pointer-events: none;
      z-index: 1000000;
    `;
  }

  flash_() {
    // TODO: Fix this type.
    /** @type {any} */
    let animation = [
      { opacity: '0.6' },
      { opacity: '0' },
    ];

    let timing = {
      duration: 1000,
    };

    document.querySelector("mt-long-tasks").animate(
      animation,
      timing
    );
  }
}

window.customElements.define('mt-long-tasks', LongTasks);
