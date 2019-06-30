export const SELECTED_PROPERTY = '--select-box-selected';
export const SIZE_PROPERTY = '--select-box-size';
export const STATE_PROPERTY = '--select-box-state';
export const ALL = 'all';
export const SOME = 'some';
export const NONE = 'none';
export const DISABLED = 'disabled';

class SelectBoxPainter {
  static get inputProperties() {
    return [SELECTED_PROPERTY, SIZE_PROPERTY, STATE_PROPERTY];
  }

  paint(ctx: CanvasRenderingContext2D, geom: any, properties: any) {
    const selected = properties.get(SELECTED_PROPERTY).toString();
    const size = Number(properties.get(SIZE_PROPERTY).toString());
    const isDisabled = properties.get(STATE_PROPERTY).toString() === 'disabled';

    ctx.strokeStyle = isDisabled ? '#bbb' : '#000';

    let halfLineWidth = 1;
    ctx.lineWidth = 2 * halfLineWidth;
    ctx.lineJoin = 'bevel';
    let offsetLeft = (geom.width - size) / 2;
    let offsetTop = (geom.height - size) / 2;
    ctx.strokeRect(offsetLeft, offsetTop, size, size);

    if (isDisabled || selected === NONE)
      return;

    if (selected === SOME)
      ctx.fillStyle = '#888';

    let innerPadding = 4;
    let innerOffsetLeft = innerPadding + (geom.width - size) / 2;
    let innerOffsetTop = innerPadding + (geom.height - size) / 2;
    ctx.fillRect(
        innerOffsetLeft, innerOffsetTop, size - 2 * innerPadding,
        size - 2 * innerPadding);
  }
}

// Don't register anything if loaded in the main thread.
// @ts-ignore Typescript doesn't know about PaintWorklet. :(
if (globalThis.registerPaint) {
  // @ts-ignore Typescript doesn't know about PaintWorklet. :(
  globalThis.registerPaint('select-box', SelectBoxPainter);
}
