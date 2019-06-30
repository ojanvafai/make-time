class HeaderFocusPainter {
  paint(ctx: CanvasRenderingContext2D, geom: any, _properties: any) {
    let width = 3;
    ctx.fillStyle = '#80b3fd';
    ctx.fillRect(0, 0, width, geom.height);
    ctx.fillRect(geom.width - width, 0, width, geom.height);
  }
}

// @ts-ignore Typescript doesn't know about PaintWorklet. :(
registerPaint('header-focus', HeaderFocusPainter);
