# HS Auto Market - Deployment Checklist

## Phase 1: Firebase Hosting Deployment ✓ (Complete)

- [x] Created `public/` folder with all frontend assets
- [x] Moved index.html, CSS, JS modules into public/
- [x] Configured Firebase with `"public": "public"` in firebase.json
- [x] Deployed to Firebase Hosting
- [x] Frontend accessible at https://hs-car.web.app

---

## Phase 2: Firebase Storage Configuration (IN PROGRESS)

### CRITICAL: Complete this before password reset will work with images

**Action Required:**
1. Install Google Cloud SDK if not present: https://cloud.google.com/sdk/docs/install
2. Run these commands:
   ```bash
   gcloud auth login
   gcloud config set project hsautomarket
   gsutil cors set cors.json gs://hsautomarket.appspot.com
   gsutil cors get gs://hsautomarket.appspot.com
   ```
3. Verify output shows the CORS configuration from `cors.json`

**Verification:**
```bash
curl -I https://storage.googleapis.com/hsautomarket.appspot.com/
# Should include: Access-Control-Allow-Origin: https://hs-car.web.app
```

---

## Phase 3: Backend (Vercel) Deployment (IN PROGRESS)

### Environment Setup
1. In your Vercel project settings, configure:
   - `RESEND_API_KEY` - Get from https://resend.com/api-keys
   - `FIREBASE_SERVICE_ACCOUNT_JSON` - Export from Firebase Console
   - `APP_URL` - Set to `https://hs-car.web.app`
   - `FRONTEND_ORIGIN` - Set to `https://hs-car.web.app`

### Deploy Backend
```bash
cd C:\Users\Administrator\Desktop\hs-car
npx vercel login
npx vercel deploy --prod --yes
```

### Verify Deployment
```bash
curl https://hs-car-backend.vercel.app/api/health
# Expected response: {"ok":true}
```

---

## Phase 4: Frontend Configuration (IN PROGRESS)

### Update API URL
1. Open `public/api-config.js`
2. Set the Vercel backend URL (e.g., `https://hs-car-backend.vercel.app`)
3. Deploy Firebase Hosting:
   ```bash
   firebase deploy --only hosting
   ```

---

## Phase 5: Full Integration Testing

### Test Password Reset Flow
1. **Step 1:** Click "Passwort zurücksetzen" on login
2. **Step 2:** Enter email address
3. **Step 3:** Check browser console for any errors
4. **Step 4:** Check email inbox for reset link
5. **Step 5:** Click reset link
6. **Step 6:** Enter new password
7. **Step 7:** Verify password changed in Firebase Auth

### Test Image Loading
1. Upload or view car listings with images
2. Images should load from Firebase Storage without CORS errors
3. No `net::ERR_FAILED` errors in browser console

### Test Firestore Data
1. Navigate to any data-driven page (listings, profile, etc.)
2. Data should load without "startTime" errors
3. Real-time updates should work

---

## Environment Variables Reference

### Vercel Backend (.env)
```
RESEND_API_KEY=re_xxxxxxxxxxxxx
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}
APP_URL=https://hs-car.web.app
FRONTEND_ORIGIN=https://hs-car.web.app
```

### Firebase Hosting (firebase.json)
```json
{
  "hosting": {
    "public": "public",
    "rewrites": [
      {
        "source": "**",
        "destination": "/index.html"
      }
    ]
  }
}
```

### Client-Side (public/api-config.js)
```javascript
window.HS_CAR_API_URL = 'https://hs-car-backend.vercel.app';
```

---

## Troubleshooting Quick Links

- **CORS Errors:** See FIREBASE_SETUP.md or TROUBLESHOOTING.md
- **Password Reset Not Sending:** Check Vercel backend logs and RESEND_API_KEY
- **Images Not Loading:** Verify Firebase Storage CORS configuration
- **Firestore Connection Failed:** Check security rules and ad-blocker settings
- **Timestamp Errors:** Ensure all Firestore documents have createdAt/updatedAt fields

---

## Security Remediation: Password Reset Tokens

Deploy the backend API update first so new reset tokens are stored only in the server-managed `passwordResetTokens` collection. Then remove tokens written to public user documents by the previous flow:

```powershell
$env:GOOGLE_APPLICATION_CREDENTIALS = 'C:\secure\path\firebase-admin-service-account.json'
node scripts/clear-legacy-password-reset-tokens.js
Remove-Item Env:GOOGLE_APPLICATION_CREDENTIALS
```

Use an admin credential for the `hsautomarket` Firebase project and keep the credential file outside the repository. The migration only deletes the legacy `resetToken` and `resetTokenExpiry` fields from user documents.

After the migration completes, deploy the Firestore rules and updated frontend to the project used by the client Firebase configuration:

```powershell
firebase deploy --only firestore:rules --project hsautomarket
firebase deploy --only hosting --project hsautomarket
```

---

## Post-Deployment Verification

After completing all phases:

```bash
# 1. Check Firebase Hosting
curl -I https://hs-car.web.app

# 2. Check Backend Health
curl https://hs-car-backend.vercel.app/api/health

# 3. Check CORS
gsutil cors get gs://hsautomarket.appspot.com

# 4. Test Password Reset Email
curl -X POST https://hs-car-backend.vercel.app/api/auth/forgot-password \
  -H "Content-Type: application/x-www-form-urlencoded" \
  -d "email=test@example.com"

# 5. Check for Console Errors
# Open https://hs-car.web.app in browser
# Press F12 to open Developer Tools
# Check Console tab for any errors
```

---

## Emergency Contacts

- **Resend Support:** https://resend.com/support
- **Firebase Support:** https://firebase.google.com/support
- **Vercel Support:** https://vercel.com/support
- **Google Cloud Support:** https://cloud.google.com/support
