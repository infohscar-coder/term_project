import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import dotenv from 'dotenv';
import { getAuth } from 'firebase-admin/auth';
import { cert, getApps, initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { Resend } from 'resend';

dotenv.config();

const requiredEnvironment = ['RESEND_API_KEY', 'FIREBASE_SERVICE_ACCOUNT_JSON'];
const missingEnvironment = requiredEnvironment.filter((name) => !process.env[name]);

if (missingEnvironment.length > 0) {
  throw new Error(`Missing required environment variables: ${missingEnvironment.join(', ')}`);
}

let serviceAccount;
try {
  serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
} catch (error) {
  throw new Error('FIREBASE_SERVICE_ACCOUNT_JSON must contain valid service-account JSON.', { cause: error });
}

const firebaseApp = getApps().length
  ? getApps()[0]
  : initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore(firebaseApp);
const auth = getAuth(firebaseApp);
const resend = new Resend(process.env.RESEND_API_KEY);
const app = express();
const port = Number(process.env.PORT) || 3000;
const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const frontendBaseUrl = 'https://hscar.net';
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');
const allowedOrigins = new Set([
  'https://hscar.net',
  'https://hs-car-7925d.web.app',
  'https://hs-car-7925d.firebaseapp.com',
  ...(process.env.FRONTEND_ORIGIN || '').split(',').map((origin) => origin.trim()).filter(Boolean)
]);
const PASSWORD_RESET_TOKEN_COLLECTION = 'passwordResetTokens';

function hashPasswordResetToken(token) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

app.use(express.json({ limit: '10kb' }));
app.use(express.urlencoded({ extended: false, limit: '10kb' }));
app.use((req, res, next) => {
  const requestOrigin = req.headers.origin;
  if (requestOrigin && allowedOrigins.has(requestOrigin)) {
    res.setHeader('Access-Control-Allow-Origin', requestOrigin);
    res.setHeader('Vary', 'Origin');
  }
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});
app.use(express.static(projectRoot));

app.get('/api/health', (_req, res) => {
  res.status(200).json({ ok: true });
});

function resetEmailHtml(resetUrl) {
  return `
    <div style="margin:0;padding:32px 16px;background:#f4f4f5;font-family:Arial,Helvetica,sans-serif;">
      <div style="max-width:560px;margin:0 auto;overflow:hidden;border:1px solid #27272a;border-radius:14px;background:#18181b;color:#ffffff;">
        <div style="padding:24px 32px;border-bottom:1px solid #3f3f46;">
          <div style="font-size:24px;font-weight:800;letter-spacing:-.02em;">
            <span style="color:#ffcc00;">H&amp;S</span> <span style="color:#ffffff;">Car</span>
          </div>
        </div>
        <div style="padding:32px;">
          <h1 style="margin:0 0 16px;color:#ffffff;font-size:24px;line-height:1.25;">Passwort zurücksetzen</h1>
          <p style="margin:0;color:#d4d4d8;font-size:15px;line-height:1.6;">
            Sie haben das Zurücksetzen Ihres Passworts angefordert. Klicken Sie auf den Button, um ein neues Passwort festzulegen.
          </p>
          <div style="padding:28px 0;text-align:center;">
            <a href="${resetUrl}" style="display:inline-block;padding:14px 26px;border-radius:8px;background:#ffcc00;color:#18181b;font-size:15px;font-weight:700;text-decoration:none;">
              Passwort zurücksetzen
            </a>
          </div>
          <p style="margin:0;color:#a1a1aa;font-size:13px;line-height:1.6;">
            Dieser Link ist eine Stunde gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.
          </p>
          <p style="margin:24px 0 0;color:#71717a;font-size:12px;line-height:1.5;word-break:break-all;">
            Falls der Button nicht funktioniert, kopieren Sie diesen Link in Ihren Browser:<br>
            <a href="${resetUrl}" style="color:#ffcc00;">${resetUrl}</a>
          </p>
        </div>
      </div>
    </div>
  `;
}

function resetEmailText(resetUrl) {
  return `Passwort zurücksetzen – H&S Car

Sie haben das Zurücksetzen Ihres Passworts angefordert.
Öffnen Sie diesen Link, um ein neues Passwort festzulegen:

${resetUrl}

Dieser Link ist eine Stunde gültig. Falls Sie diese Anfrage nicht gestellt haben, können Sie diese E-Mail ignorieren.`;
}

app.post('/api/auth/forgot-password', async (req, res) => {
  const sanitizedEmail = typeof req.body?.email === 'string'
    ? req.body.email.trim().toLowerCase()
    : '';
  const userEmail = sanitizedEmail;

  if (!emailPattern.test(sanitizedEmail)) {
    return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich.' });
  }

  try {
    let firebaseUser;
    try {
      firebaseUser = await auth.getUserByEmail(sanitizedEmail);
    } catch (error) {
      if (error.code === 'auth/user-not-found') {
        console.warn('Firebase Auth user not found for password reset:', sanitizedEmail);
        return res.status(200).json({ success: true });
      }
      console.error('Firebase Auth lookup failed:', error);
      throw error;
    }

    const resetToken = crypto.randomBytes(32).toString('hex');
    const tokenRef = db.collection(PASSWORD_RESET_TOKEN_COLLECTION).doc(hashPasswordResetToken(resetToken));

    await tokenRef.set({
      uid: firebaseUser.uid,
      expiresAt: new Date(Date.now() + 60 * 60 * 1000)
    });

    const resetUrl = new URL('/reset-password.html', frontendBaseUrl);
    resetUrl.searchParams.set('token', resetToken);

    let resendResponse;
    try {
      resendResponse = await resend.emails.send({
        from: 'H&S Car <noreply@hscar.net>',
        to: userEmail,
        subject: 'Password Reset',
        html: resetEmailHtml(resetUrl.toString()),
        text: resetEmailText(resetUrl.toString())
      });
    } catch (error) {
      console.error('Resend request threw an exception:', error);
      throw error;
    }

    if (resendResponse.error) {
      console.error('Resend returned an error response:', resendResponse.error);
      throw new Error(`Resend email failed: ${resendResponse.error.message || 'Unknown Resend error'}`);
    }

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Password reset request failed:', error);
    return res.status(500).json({ error: 'E-Mail konnte nicht gesendet werden.' });
  }
});

app.post('/api/auth/reset-password', async (req, res) => {
  const token = typeof req.body?.token === 'string' ? req.body.token.trim() : '';
  const newPassword = typeof req.body?.newPassword === 'string' ? req.body.newPassword : '';

  if (!token || newPassword.length < 8) {
    return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link.' });
  }

  try {
    const tokenRef = db.collection(PASSWORD_RESET_TOKEN_COLLECTION).doc(hashPasswordResetToken(token));
    const uid = await db.runTransaction(async (transaction) => {
      const tokenSnapshot = await transaction.get(tokenRef);
      if (!tokenSnapshot.exists) return null;

      const tokenData = tokenSnapshot.data();
      const expiry = tokenData.expiresAt?.toDate
        ? tokenData.expiresAt.toDate()
        : new Date(tokenData.expiresAt);
      const valid = Number.isFinite(expiry.getTime())
        && expiry.getTime() > Date.now()
        && typeof tokenData.uid === 'string'
        && tokenData.uid.length > 0;

      transaction.delete(tokenRef);
      return valid ? tokenData.uid : null;
    });

    if (!uid) {
      return res.status(400).json({ error: 'Ungültiger oder abgelaufener Link.' });
    }

    await auth.updateUser(uid, { password: newPassword });

    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Password reset completion failed:', error);
    return res.status(500).json({ error: 'Passwort konnte nicht gespeichert werden.' });
  }
});

if (!process.env.VERCEL && process.env.FUNCTIONS_EMULATOR !== 'true' && process.env.FUNCTION_TARGET !== 'api') {
  app.listen(port, () => {
    console.log(`H&S Car API listening on port ${port}`);
  });
}

export default app;
