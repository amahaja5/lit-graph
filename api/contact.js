import { handleContact } from '../lib/contact.js';

export default function handler(req, res) {
  return handleContact(req, res);
}
