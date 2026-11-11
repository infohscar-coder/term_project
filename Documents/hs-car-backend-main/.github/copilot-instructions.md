# Project Rules & Architecture Guidelines

## Tech Stack
- Frontend: Vanilla JavaScript (ES6 Modules) + HTML/CSS
- Backend: Firebase v10 Modular SDK (Auth, Firestore, Storage, Hosting)

## Coding Guidelines
- **Modularity**: Use import/export for all Firebase and utility logic.
- **Async Code**: Always use async/await and wrap database calls in try...catch blocks.
- **Image Handling**: Always compress images on the client side before uploading to Firebase Storage (max width: 1200px, JPEG quality: 0.8).
- **Error Handling**: Log errors clearly and provide user-friendly feedback in the UI.
- **Security**: Associate created documents with the active user's uid as ownerId.