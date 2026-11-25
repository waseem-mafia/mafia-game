import { initializeApp } from "firebase/app";
import { getDatabase } from "firebase/database";

const firebaseConfig = {
  apiKey: "AIzaSyDaE7vu-dmEGthMdSxsODkFZNCjeZfPrIA",
  authDomain: "mafia-w-game.firebaseapp.com",
  databaseURL: "https://mafia-w-game-default-rtdb.firebaseio.com",
  projectId: "mafia-w-game",
  storageBucket: "mafia-w-game.firebasestorage.app",
  messagingSenderId: "874195741506",
  appId: "1:874195741506:web:cb4e834dc3425d86beb6db",
  measurementId: "G-1GBCK9SNY5"
};

const app = initializeApp(firebaseConfig);
export const db = getDatabase(app);