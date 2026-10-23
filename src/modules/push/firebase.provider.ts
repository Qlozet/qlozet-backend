import { Logger } from '@nestjs/common';
import * as admin from 'firebase-admin';

export const FIREBASE_APP = 'FIREBASE_APP';

/**
 * Firebase Admin, authenticated with a service account through the FCM
 * HTTP v1 API (the legacy server-key API is shut down).
 *
 * Optional by design: without FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL /
 * FIREBASE_PRIVATE_KEY the provider is null and pushes are skipped (logged
 * once), so the API runs in every environment before Firebase is set up.
 */
export const firebaseProvider = {
  provide: FIREBASE_APP,
  useFactory: (): admin.app.App | null => {
    const projectId = process.env.FIREBASE_PROJECT_ID;
    const clientEmail = process.env.FIREBASE_CLIENT_EMAIL;
    const privateKey = process.env.FIREBASE_PRIVATE_KEY;
    if (!projectId || !clientEmail || !privateKey) {
      new Logger('Push').warn(
        'Firebase is not configured (FIREBASE_PROJECT_ID / FIREBASE_CLIENT_EMAIL / FIREBASE_PRIVATE_KEY); push notifications are off.',
      );
      return null;
    }
    const name = 'qlozet-push';
    const existing = admin.apps.find((a) => a?.name === name);
    if (existing) return existing;
    return admin.initializeApp(
      {
        credential: admin.credential.cert({
          projectId,
          clientEmail,
          // Secrets flatten newlines; restore them.
          privateKey: privateKey.replace(/\\n/g, '\n'),
        }),
      },
      name,
    );
  },
};
