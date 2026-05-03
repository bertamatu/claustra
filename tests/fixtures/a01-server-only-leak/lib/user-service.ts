import { db } from './db.js';

export const fetchUser = (id: string): Promise<unknown> => db.user(id);
