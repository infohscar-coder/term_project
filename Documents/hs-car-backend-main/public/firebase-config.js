import { getApp, getApps, initializeApp } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-app.js";
import { getAuth, GoogleAuthProvider } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-auth.js";
import { initializeFirestore } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-firestore.js";
import { getStorage } from "https://www.gstatic.com/firebasejs/10.12.5/firebase-storage.js";

const firebaseConfig = {
  apiKey: "AIzaSyAvxtmSj8KpOQHVrpNMOjiaWD9OLWNiwwE",
  authDomain: "hsautomarket.firebaseapp.com",
  projectId: "hsautomarket",
  storageBucket: "hsautomarket.firebasestorage.app",
  messagingSenderId: "643216976105",
  appId: "1:643216976105:web:bfa3f852091299d3fba878",
  measurementId: "G-ZLY0XEECM7"
};

export const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

export const auth = getAuth(app);
export const googleProvider = new GoogleAuthProvider();
export const db = initializeFirestore(app, {
  experimentalForceLongPolling: true,
});
export const storage = getStorage(app);