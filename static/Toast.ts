export class Toast extends HTMLElement {
  constructor(...message: (string|Node)[]) {
    super();

    this.style.cssText = `
      position: fixed;
      top: 50%;
      right: 0;
      bottom: 0;
      left: 0;
      font-size: 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      pointer-events: none;
      opacity: 0.85;
    `;

    let text = document.createElement('div');
    text.style.cssText = `
      background-color: var(--inverted-overlay-background-color);
      padding: 10px;
      border-radius: 3px;
      border: 1px solid var(--border-and-hover-color);
      color: var(--inverted-text-color);
    `;
    text.append(...message);
    this.append(text);
  }

  connectedCallback() {
    let animation = this.animate(
        [
          {opacity: '0.85'},
          {opacity: '0'},
        ],
        {
          duration: 500,
          delay: 3000,
        });
    animation.onfinish = () => this.remove();
  }
}
window.customElements.define('mt-toast', Toast);
