const COLOR_PROPERTY = '--selected-background-color';

class HeaderFocusPainter {
  static get inputProperties() {
    return [COLOR_PROPERTY];
  }

  paint(ctx: CanvasRenderingContext2D, geom: any, properties: any) {
    let width = 3;
    ctx.fillStyle = properties.get(COLOR_PROPERTY).toString();
    ctx.fillRect(0, 0, width, geom.height);
    ctx.fillRect(geom.width - width, 0, width, geom.height);
  }
}

// @ts-ignore Typescript doesn't know about PaintWorklet. :(
registerPaint('header-focus', HeaderFocusPainter);
