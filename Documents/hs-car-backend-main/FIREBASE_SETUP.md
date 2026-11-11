# Firebase Configuration Setup

## Required Firebase Storage CORS Configuration

The application is reporting CORS errors when loading images from Firebase Storage. To fix this, you must configure the Cloud Storage bucket with CORS headers.

### Step 1: Set Up gsutil (if not already installed)
- Install Google Cloud SDK: https://cloud.google.com/sdk/docs/install
- Run: `gcloud auth login`
- Run: `gcloud config set project hsautomarket`

### Step 2: Create CORS Configuration File

Create a file named `cors.json` in your project root with:

```json
[
  {
    "origin": ["https://hs-car.web.app", "https://hs-car-7925d.web.app", "http://localhost:3000", "http://localhost:5000"],
    "method": ["GET", "HEAD", "DELETE", "POST", "PUT", "OPTIONS"],
    "responseHeader": ["Content-Type", "Cache-Control"],
    "maxAgeSeconds": 3600
  }
]
```

### Step 3: Apply CORS Configuration

Run this command to apply CORS to your Firebase Storage bucket:

```bash
gsutil cors set cors.json gs://hsautomarket.appspot.com
```

Or if your bucket name is different:

```bash
gsutil cors set cors.json gs://hsautomarket.firebasestorage.app
```

### Step 4: Verify Configuration

```bash
gsutil cors get gs://hsautomarket.appspot.com
```

## Firestore Timestamp Issue

The error "Cannot read properties of undefined (reading 'startTime')" indicates a Firestore document without proper timestamp fields. Ensure all Firestore documents have valid `createdAt`/`updatedAt` fields:

```javascript
// When creating documents, always include timestamps:
await setDoc(doc(db, 'collection', 'docId'), {
  // ... other fields
  createdAt: serverTimestamp(),
  updatedAt: serverTimestamp()
});
```

## Environment Variables

Ensure your Vercel/backend `.env` has:
- `RESEND_API_KEY` - Resend email service key
- `FIREBASE_SERVICE_ACCOUNT_JSON` - Firebase admin credentials (JSON string)
- `APP_URL` - https://hs-car.web.app
- `FRONTEND_ORIGIN` - https://hs-car.web.app

## Testing CORS

After applying the configuration, test with:

```bash
curl -H "Origin: https://hs-car.web.app" \
  -H "Access-Control-Request-Method: GET" \
  -H "Access-Control-Request-Headers: Content-Type" \
  -X OPTIONS \
  https://firebasestorage.googleapis.com/v0/b/hsautomarket.appspot.com/o
```

Should return CORS headers including `Access-Control-Allow-Origin: https://hs-car.web.app`.
