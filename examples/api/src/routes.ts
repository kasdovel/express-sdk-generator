import { Router } from 'express';
import { randomUUID } from 'node:crypto';
import { createRoute } from '@kasdovel/express-sdkgen-core';
import * as S from './schemas.js';

export const router: Router = Router();

interface UserRecord {
  id: string;
  name: string;
  email: string;
}

const users = new Map<string, UserRecord>();

createRoute(router, {
  method: 'get',
  path: '/users',
  operationId: 'listUsers',
  summary: 'List users',
  tags: ['users'],
  request: { query: S.ListQuery },
  responses: { 200: S.UserList },
  handler: (req, res) => {
    const limit = req.valid.query.limit ?? 50;
    res.json([...users.values()].slice(0, limit));
  },
});

createRoute(router, {
  method: 'post',
  path: '/users',
  operationId: 'createUser',
  summary: 'Create a user',
  tags: ['users'],
  request: { body: S.CreateUser },
  responses: { 201: S.User, 400: S.ErrorBody },
  handler: (req, res) => {
    const user: UserRecord = { id: randomUUID(), ...req.valid.body };
    users.set(user.id, user);
    res.status(201).json(user);
  },
});

createRoute(router, {
  method: 'get',
  path: '/users/:id',
  operationId: 'getUser',
  summary: 'Get a user by id',
  tags: ['users'],
  request: { params: S.IdParam },
  responses: { 200: S.User, 404: S.ErrorBody },
  handler: (req, res) => {
    const user = users.get(req.valid.params.id);
    if (!user) {
      res.status(404).json({ error: 'User not found' });
      return;
    }
    res.json(user);
  },
});
