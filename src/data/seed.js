import 'dotenv/config';
import { db } from '../lib/db.js';

try {
  await db.init();
  console.log('TrueLead storage initialized:', db.storage === 'postgres' ? 'PostgreSQL' : db.filePath);
  console.log('Admin email:', process.env.ADMIN_EMAIL || 'trueleadsite@gmail.com');
} finally {
  await db.close();
}
