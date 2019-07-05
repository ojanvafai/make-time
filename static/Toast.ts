export class Toast extends HTMLElement {
  constructor(message: string) {
    super();

    this.style.cssText = `
      position: fixed;
      top: 50%;
      right: 0;
      bottom: 0;
      left: 0;
      font-size: 20px;
      opacity: 0.5;
      display: flex;
      align-items: center;
      justify-content: center;
      transition: opacity 0.5s;
      transition-delay: 3s;
      opacity: 0.95;
      pointer-events: none;
    `;

    let text = document.createElement('div');
    text.style.cssText = `
      background-color: #000000bb;
      padding: 10px;
      border-radius: 3px;
      border: 1px solid var(--border-color);
      color: #ffffffbb;
    `;
    text.append(message);
    this.append(text);

    setTimeout(() => this.style.opacity = '0');
    this.addEventListener('transitionend', () => {this.remove()});
  }
}
window.customElements.define('mt-toast', Toast);
