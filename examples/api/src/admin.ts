import { router } from '@kasdovel/express-sdkgen-core';
import { z } from 'zod';
import * as S from './schemas.js';

// Demonstrates nested routers: `accounts` is mounted at /accounts, and an
// `admins` sub-router is mounted under it. Spec paths come out fully-qualified
// (/accounts, /accounts/admins/{id}) even though each route is declared with a
// local path.
export const accounts = router('/accounts');

accounts.route({
  method: 'get',
  path: '/',
  operationId: 'listAccounts',
  tags: ['accounts'],
  responses: { 200: z.array(S.User) },
  handler: (_req, res) => {
    res.json([]);
  },
});

const admins = accounts.router('/admins');

admins.route({
  method: 'get',
  path: '/:id',
  operationId: 'getAccountAdmin',
  tags: ['accounts'],
  request: { params: S.IdParam },
  responses: { 200: S.User, 404: S.ErrorBody },
  handler: (req, res) => {
    res.json({
      id: req.valid.params.id,
      name: 'Admin',
      email: 'admin@example.com',
    });
  },
});
