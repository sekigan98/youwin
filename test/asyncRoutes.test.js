import test from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { wrapAsyncRouter } from '../src/lib/asyncRoutes.js';

test('propaga rechazos async al error handler de Express 4', async () => {
  const router = express.Router();
  router.get('/boom', async () => {
    await Promise.resolve();
    throw new Error('fallo controlado');
  });
  wrapAsyncRouter(router);

  const layer = router.stack.find((item) => item.route).route.stack[0];
  const error = await new Promise((resolve) => {
    layer.handle({}, {}, resolve);
  });
  assert.equal(error.message, 'fallo controlado');
});
