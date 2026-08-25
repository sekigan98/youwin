function wrapHandler(handler) {
  if (handler.length === 4 || handler.__trueLeadAsyncWrapped) return handler;
  function asyncSafeHandler(req, res, next) {
    try {
      Promise.resolve(handler(req, res, next)).catch(next);
    } catch (error) {
      next(error);
    }
  }
  asyncSafeHandler.__trueLeadAsyncWrapped = true;
  return asyncSafeHandler;
}

export function wrapAsyncRouter(router) {
  for (const layer of router?.stack || []) {
    if (layer.route?.stack) {
      for (const routeLayer of layer.route.stack) routeLayer.handle = wrapHandler(routeLayer.handle);
    } else if (layer.handle?.stack) {
      wrapAsyncRouter(layer.handle);
    } else if (typeof layer.handle === 'function') {
      layer.handle = wrapHandler(layer.handle);
    }
  }
  return router;
}
