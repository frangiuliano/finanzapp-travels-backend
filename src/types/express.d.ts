import { UserDocument } from '../users/user.schema';
import { ShortcutIdentity } from '../shortcut-integrations/shortcut-integrations.service';

declare global {
  namespace Express {
    interface Request {
      user?: UserDocument;
      shortcutIdentity?: ShortcutIdentity;
    }
  }
}

export {};
