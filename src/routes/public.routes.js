import express from 'express';
import { getPricingForRequest } from '../lib/pricing.js';

export const publicRouter = express.Router();

publicRouter.get('/pricing', (req, res) => {
  res.json(getPricingForRequest(req));
});
