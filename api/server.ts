import express from "express";
import path from "path";
import { createServer as createViteServer } from "vite";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

const app = express();
const PORT = 3000;

app.use(express.json());

function cleanString(str: any): string {
  if (typeof str !== "string") str = String(str || "");
  return str.trim().toLowerCase().replace(/\s+/g, ' ');
}

// Gemini evaluate guess proxy
app.post("/api/gemini/evaluate-guess", async (req, res) => {
  try {
    console.log("Received guess request:", req.body);
    const { targetName, guess, category } = req.body;
    if (!targetName || !guess) {
      console.warn("Missing targetName or guess:", req.body);
      return res.status(400).json({ error: "Missing targetName or guess" });
    }

    const cleanTarget = cleanString(targetName);
    const cleanGuess = cleanString(guess);

    // 1. Direct exact match
    if (cleanTarget === cleanGuess) {
      return res.json({ isMatch: true, explanation: "Exact match" });
    }

    // 2. Simple character-by-character similarity heuristic
    if (cleanGuess.length >= 4 && (cleanTarget.includes(cleanGuess) || cleanGuess.includes(cleanTarget))) {
      return res.json({ isMatch: true, explanation: "Sub-string matching" });
    }

    // 3. Fallback: Not a match
    return res.json({ isMatch: false, explanation: "Incorrect guess (local validation)" });
  } catch (err: any) {
    console.error("Error in evaluate-guess:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// Vite middleware for development
async function startServer() {
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on port ${PORT}`);
  });
}

// Only start the server directly if not running as a Vercel serverless function
if (process.env.NODE_ENV !== "production" || !process.env.VERCEL) {
  startServer();
}

export default app;
